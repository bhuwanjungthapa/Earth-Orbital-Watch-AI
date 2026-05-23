const cache = new Map();
const ttlMs = 1000 * 60 * 60 * 24;

export async function handler(event) {
  const query = event.queryStringParameters ?? {};
  const name = cleanObjectName(query.name ?? "");
  const type = query.type ?? "payload";
  const cacheKey = `${name}:${type}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < ttlMs) {
    return json(cached.payload, 200, "HIT");
  }

  try {
    const payload = name ? await findWikipediaImage(name, type) : emptyResult();
    cache.set(cacheKey, {
      createdAt: Date.now(),
      payload
    });

    return json(payload, 200, "MISS");
  } catch (error) {
    return json(
      {
        ...emptyResult(),
        error: error instanceof Error ? error.message : "Image lookup failed."
      },
      200,
      "ERROR"
    );
  }
}

async function findWikipediaImage(name, type) {
  const queries = buildSearchQueries(name, type);

  for (const search of queries) {
    const result = await queryWikipedia(search);
    if (result?.imageUrl) return result;
  }

  for (const search of queries) {
    const result = await queryGoogleImage(search);
    if (result?.imageUrl) return result;
  }

  return emptyResult();
}

async function queryWikipedia(search) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: search,
    gsrlimit: "1",
    prop: "pageimages|extracts|info",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    piprop: "thumbnail|original",
    pithumbsize: "640",
    format: "json"
  }).toString();

  const response = await fetch(url, {
    headers: {
      "user-agent": "Earth-Orbital-Watch-AI/0.1 (Wikimedia image lookup)"
    }
  });

  if (!response.ok) {
    throw new Error(`Wikipedia lookup failed: ${response.status}`);
  }

  const data = await response.json();
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page) return null;

  const imageUrl = page.original?.source ?? page.thumbnail?.source ?? null;
  if (!imageUrl) return null;

  return {
    title: page.title ?? null,
    pageUrl: page.fullurl ?? null,
    imageUrl,
    extract: page.extract ?? null,
    source: "wikipedia"
  };
}

function buildSearchQueries(name, type) {
  const base = cleanObjectName(name);
  const compact = base.replace(/\s+\((.*?)\)/g, " ").replace(/\s+/g, " ").trim();
  const withoutNumbers = compact.replace(/\b\d{2,}\b/g, " ").replace(/\s+/g, " ").trim();
  const typeWord = type === "rocket_body" ? "rocket body" : type === "debris" ? "space debris" : "satellite";

  return Array.from(new Set([
    `${compact} spacecraft`,
    `${compact} satellite`,
    compact,
    `${withoutNumbers} ${typeWord}`,
    withoutNumbers
  ].filter((value) => value.length > 2)));
}

async function queryGoogleImage(search) {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (!key || !cx) return null;

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.search = new URLSearchParams({
    key,
    cx,
    q: search,
    searchType: "image",
    num: "1",
    safe: "active",
    imgSize: "large",
    fields: "items(title,link,image/contextLink,snippet)"
  }).toString();

  const response = await fetch(url, {
    headers: {
      "user-agent": "Earth-Orbital-Watch-AI/0.1 (Google Custom Search image fallback)"
    }
  });

  if (!response.ok) {
    throw new Error(`Google image lookup failed: ${response.status}`);
  }

  const data = await response.json();
  const item = data.items?.[0];
  if (!item?.link) return null;

  return {
    title: item.title ?? null,
    pageUrl: item.image?.contextLink ?? null,
    imageUrl: item.link,
    extract: item.snippet ?? null,
    source: "google"
  };
}

function cleanObjectName(value) {
  return value
    .replace(/\b(DEB|R\/B|AKM|OBJECT|TBA|UNKNOWN)\b/gi, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function emptyResult() {
  return {
    title: null,
    pageUrl: null,
    imageUrl: null,
    extract: null,
    source: "none"
  };
}

function json(payload, statusCode, cacheStatus) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=86400, s-maxage=86400",
      "x-image-cache": cacheStatus
    },
    body: JSON.stringify(payload)
  };
}
