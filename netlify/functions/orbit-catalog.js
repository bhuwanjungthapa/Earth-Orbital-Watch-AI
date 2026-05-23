import { mergeCatalogs, parseTleCatalog, pickGroups } from "./_shared/orbit-utils.js";

const cache = new Map();
const ttlMs = 1000 * 60 * 60 * 2;
const catalogVersion = "2026-05-23-b";

export async function handler(event) {
  const query = event.queryStringParameters ?? {};
  const provider = query.provider === "spacetrack" ? "spacetrack" : "celestrak";
  const preset = query.preset ?? "wide";
  const limit = clampNumber(Number(query.limit), 500, 60000, 18000);
  const cacheKey = `${catalogVersion}:${provider}:${preset}:${limit}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < ttlMs) {
    return json(cached.payload, 200, "HIT");
  }

  try {
    const payload = provider === "spacetrack"
      ? await fetchSpaceTrackCatalog(limit)
      : await fetchCelestrakCatalog(preset, limit);

    cache.set(cacheKey, {
      createdAt: Date.now(),
      payload
    });

    return json(payload, 200, "MISS");
  } catch (error) {
    return json(
      {
        provider,
        fetchedAt: new Date().toISOString(),
        objects: [],
        errors: [error instanceof Error ? error.message : "Unknown catalog fetch error"]
      },
      provider === "spacetrack" ? 400 : 502,
      "ERROR"
    );
  }
}

async function fetchCelestrakCatalog(preset, limit) {
  const groups = pickGroups(preset);
  const settled = await fetchGroupsWithLimit(groups, 4);

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

  async function worker() {
    while (cursor < groups.length) {
      const index = cursor;
      cursor += 1;

      try {
        results[index] = {
          status: "fulfilled",
          value: await fetchCelestrakGroup(groups[index])
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
  return results;
}

async function fetchCelestrakGroup(group) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await sleep(450 + attempt * 300);
    }

    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Earth-Orbital-Watch-AI/0.1"
        }
      });

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

function json(payload, statusCode, cacheStatus) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=900, s-maxage=7200",
      "x-orbit-cache": cacheStatus
    },
    body: JSON.stringify(payload)
  };
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}
