import { mergeCatalogs, parseTleCatalog, pickGroups } from "./_shared/orbit-utils.js";

const cache = new Map();
const ttlMs = 1000 * 60 * 60 * 2;
const catalogVersion = "2026-05-23-d";
const maxResponseBytes = 5_200_000;
const functionDeadlineMs = 8_200;
const celestrakTimeoutMs = 4_200;
const fallbackTles = `ISS (ZARYA)
1 25544U 98067A   24001.00000000  .00016717  00000-0  30525-3 0  9993
2 25544  51.6416  91.3564 0005000  76.0246  44.1837 15.50000000429999
HUBBLE SPACE TELESCOPE
1 20580U 90037B   24001.00000000  .00001000  00000-0  53000-4 0  9992
2 20580  28.4697 124.2578 0002800  73.1440 287.0090 15.09200000381234
NOAA 19
1 33591U 09005A   24001.00000000  .00000120  00000-0  90000-4 0  9991
2 33591  99.1943  35.8105 0014000 188.0011 172.0912 14.12400000770123
GOES 16
1 41866U 16071A   24001.00000000 -.00000250  00000-0  00000+0 0  9990
2 41866   0.0460  89.9112 0002000 270.0000 180.0000  1.00270000026011
STARLINK-30000
1 58000U 23111A   24001.00000000  .00002000  00000-0  15000-3 0  9995
2 58000  53.2167 210.0000 0001200  78.0000 282.0000 15.08800000100123
ONEWEB-0500
1 48000U 21000A   24001.00000000  .00000300  00000-0  70000-4 0  9991
2 48000  87.9000  12.0000 0003000  40.0000 320.0000 13.18000000221011
COSMOS 2251 DEB
1 35433U 93036AKB 24001.00000000  .00008000  00000-0  85000-3 0  9997
2 35433  74.0300  15.2200 0025465 203.0000 157.0000 14.35000000748011
FENGYUN 1C DEB
1 30670U 99025AA  24001.00000000  .00012000  00000-0  11000-2 0  9995
2 30670  98.7600 210.1000 0065000  95.0000 265.0000 14.81000000891234
DELTA 2 R/B
1 24876U 97035B   24001.00000000  .00000200  00000-0  65000-4 0  9990
2 24876  35.4200 180.1000 0130000 110.0000 250.0000 13.70000000321230
MOLNIYA 3-50
1 25847U 99036A   24001.00000000  .00000070  00000-0  00000+0 0  9996
2 25847  63.4000 300.0000 7200000 270.0000  20.0000  2.00600000191111`;

export async function handler(event) {
  const query = event.queryStringParameters ?? {};
  const provider = query.provider === "spacetrack" ? "spacetrack" : "celestrak";
  const preset = query.preset ?? "wide";
  const limit = clampNumber(Number(query.limit), 500, 18000, 12000);
  const cacheKey = `${catalogVersion}:${provider}:${preset}:${limit}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < ttlMs) {
    return json(cached.payload, 200, "HIT");
  }

  try {
    const fetchedPayload = provider === "spacetrack"
      ? await fetchSpaceTrackCatalog(limit)
      : await fetchCelestrakCatalog(preset, limit);
    const payload = fitPayloadToResponseBudget(fetchedPayload);

    cache.set(cacheKey, {
      createdAt: Date.now(),
      payload
    });

    return json(payload, 200, "MISS");
  } catch (error) {
    if (provider === "celestrak") {
      const payload = fallbackCatalog(preset, error);
      cache.set(cacheKey, {
        createdAt: Date.now(),
        payload
      });
      return json(payload, 200, "FALLBACK");
    }

    return json(
      {
        provider,
        preset,
        groups: [],
        fetchedAt: new Date().toISOString(),
        objectCount: 0,
        objects: [],
        errors: [error instanceof Error ? error.message : "Unknown catalog fetch error"]
      },
      provider === "spacetrack" ? 400 : 200,
      "ERROR"
    );
  }
}

async function fetchCelestrakCatalog(preset, limit) {
  const groups = pickGroups(preset);
  const settled = await fetchGroupsWithLimit(groups, 5);

  const catalogs = [];
  const errors = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      catalogs.push(result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  const objects = mergeCatalogs(catalogs, limit);
  if (!objects.length) {
    throw new Error(errors[0] ?? "CelesTrak did not return any catalog objects before the function deadline.");
  }

  return {
    provider: "CelesTrak",
    preset,
    groups,
    fetchedAt: new Date().toISOString(),
    objectCount: objects.length,
    objects,
    errors
  };
}

async function fetchGroupsWithLimit(groups, concurrency) {
  const results = [];
  let cursor = 0;
  const deadlineAt = Date.now() + functionDeadlineMs;

  async function worker() {
    while (cursor < groups.length) {
      const index = cursor;
      cursor += 1;

      if (Date.now() > deadlineAt - 850) {
        results[index] = {
          status: "rejected",
          reason: new Error(`${groups[index]}: skipped to keep the serverless function within its production deadline`)
        };
        continue;
      }

      try {
        results[index] = {
          status: "fulfilled",
          value: await fetchCelestrakGroup(groups[index], deadlineAt)
        };
      } catch (error) {
        results[index] = {
          status: "rejected",
          reason: error
        };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  for (let index = 0; index < groups.length; index += 1) {
    if (!results[index]) {
      results[index] = {
        status: "rejected",
        reason: new Error(`${groups[index]}: not attempted before the function deadline`)
      };
    }
  }
  return results;
}

async function fetchCelestrakGroup(group, deadlineAt) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
  let lastError = null;
  const attempts = process.env.NETLIFY ? 1 : 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(450 + attempt * 300);
    }

    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          "user-agent": "Earth-Orbital-Watch-AI/0.1"
        }
      }, Math.max(900, Math.min(celestrakTimeoutMs, deadlineAt - Date.now() - 250)));

      if (!response.ok) {
        throw new Error(`${group}: ${response.status}`);
      }

      const text = await response.text();
      return parseTleCatalog(text, group, "CelesTrak");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSpaceTrackCatalog(limit) {
  const identity = process.env.SPACE_TRACK_IDENTITY;
  const password = process.env.SPACE_TRACK_PASSWORD;

  if (!identity || !password) {
    throw new Error("Space-Track credentials are not configured.");
  }

  const login = await fetch("https://www.space-track.org/ajaxauth/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Earth-Orbital-Watch-AI/0.1"
    },
    body: new URLSearchParams({ identity, password }).toString()
  });

  if (!login.ok) {
    throw new Error(`Space-Track login failed: ${login.status}`);
  }

  const cookie = login.headers.get("set-cookie");
  const query = [
    "https://www.space-track.org/basicspacedata/query/class/gp",
    "decay_date/null-val",
    "epoch/%3Enow-30",
    "orderby/norad_cat_id",
    `limit/${limit}`,
    "format/tle"
  ].join("/");

  const response = await fetch(query, {
    headers: {
      cookie: cookie ?? "",
      "user-agent": "Earth-Orbital-Watch-AI/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Space-Track query failed: ${response.status}`);
  }

  const text = await response.text();
  const objects = mergeCatalogs([parseTleCatalog(text, "space-track-all", "Space-Track")], limit);

  return {
    provider: "Space-Track",
    preset: "all-on-orbit",
    groups: ["space-track-all"],
    fetchedAt: new Date().toISOString(),
    objectCount: objects.length,
    objects,
    errors: []
  };
}

function fallbackCatalog(preset, error) {
  const objects = parseTleCatalog(fallbackTles, "fallback", "Fallback");

  return {
    provider: "Fallback",
    preset,
    groups: ["fallback"],
    fetchedAt: new Date().toISOString(),
    objectCount: objects.length,
    objects,
    errors: [
      "Live catalog temporarily unavailable; using bundled fallback objects.",
      error instanceof Error ? error.message : "Unknown catalog fetch error"
    ]
  };
}

function fitPayloadToResponseBudget(payload) {
  const initialBody = JSON.stringify(payload);
  if (Buffer.byteLength(initialBody, "utf8") <= maxResponseBytes || !Array.isArray(payload.objects)) {
    return payload;
  }

  let low = 0;
  let high = payload.objects.length;
  let best = {
    ...payload,
    objects: [],
    objectCount: 0,
    errors: [...(payload.errors ?? []), responseBudgetMessage(payload.objects.length, 0)]
  };

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = {
      ...payload,
      objects: payload.objects.slice(0, mid),
      objectCount: mid,
      errors: [...(payload.errors ?? []), responseBudgetMessage(payload.objects.length, mid)]
    };
    const body = JSON.stringify(candidate);

    if (Buffer.byteLength(body, "utf8") <= maxResponseBytes) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function responseBudgetMessage(originalCount, returnedCount) {
  return `Returned ${returnedCount.toLocaleString()} of ${originalCount.toLocaleString()} objects to stay within Netlify response limits.`;
}

function json(payload, statusCode, cacheStatus) {
  const safePayload = fitPayloadToResponseBudget(payload);

  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=900, s-maxage=7200",
      "x-orbit-cache": cacheStatus
    },
    body: JSON.stringify(safePayload)
  };
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}
