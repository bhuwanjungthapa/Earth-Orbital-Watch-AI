const cache = new Map();
const ttlMs = 1000 * 60 * 60 * 24;
const userAgent = "Earth-Orbital-Watch-AI/0.1 (public orbital image lookup)";

export async function handler(event) {
  const query = event.queryStringParameters ?? {};
  const rawName = query.name ?? "";
  const name = cleanObjectName(rawName);
  const type = query.type ?? "payload";
  const norad = query.norad ?? "";
  const cacheKey = `${name}:${type}:${norad}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < ttlMs) {
    return json(cached.payload, 200, "HIT");
  }

  try {
    const payload = name ? await findPublicImage({ name, rawName, type, norad }) : emptyResult();
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

async function findPublicImage({ name, rawName, type, norad }) {
  const queries = buildSearchQueries(name || rawName, type, norad);
  const lookups = [queryWikipedia, queryWikidata, queryCommonsImage, queryGoogleImage, queryNasaImage];

  for (const lookup of lookups) {
    for (const search of queries) {
      try {
        const result = await lookup(search);
        if (result?.imageUrl) return result;
      } catch {
        continue;
      }
    }
  }

  return emptyResult();
}

async function queryWikipedia(search) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: search,
    gsrlimit: "5",
    prop: "pageimages|extracts|info",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    piprop: "thumbnail|original",
    pithumbsize: "720",
    format: "json",
    origin: "*"
  }).toString();

  const data = await fetchJson(url, "Wikipedia lookup failed");
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  for (const page of pages) {
    if (/^list of/i.test(page.title ?? "")) continue;
    if (!isRelevantResult(search, page.title ?? "", page.extract ?? "")) continue;
    const imageUrl = page.original?.source ?? page.thumbnail?.source ?? null;
    if (!isUsableImageUrl(imageUrl)) continue;

    return {
      title: page.title ?? null,
      pageUrl: page.fullurl ?? null,
      imageUrl,
      extract: page.extract ?? null,
      source: "wikipedia"
    };
  }

  return null;
}

async function queryWikidata(search) {
  const searchUrl = new URL("https://www.wikidata.org/w/api.php");
  searchUrl.search = new URLSearchParams({
    action: "wbsearchentities",
    search,
    language: "en",
    format: "json",
    limit: "5",
    type: "item",
    origin: "*"
  }).toString();

  const searchData = await fetchJson(searchUrl, "Wikidata search failed");
  const ids = (searchData.search ?? []).map((item) => item.id).filter(Boolean).slice(0, 5);
  if (!ids.length) return null;

  const entityUrl = new URL("https://www.wikidata.org/w/api.php");
  entityUrl.search = new URLSearchParams({
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "claims|labels|descriptions|sitelinks",
    languages: "en",
    format: "json",
    origin: "*"
  }).toString();

  const entityData = await fetchJson(entityUrl, "Wikidata entity lookup failed");
  for (const id of ids) {
    const entity = entityData.entities?.[id];
    const imageName = entity?.claims?.P18?.find((claim) => claim?.mainsnak?.datavalue?.value)?.mainsnak?.datavalue?.value;
    if (!imageName) continue;
    if (!isRelevantResult(search, entity.labels?.en?.value ?? "", entity.descriptions?.en?.value ?? "")) continue;

    const imageUrl = commonsFilePath(imageName);
    if (!isUsableImageUrl(imageUrl)) continue;

    return {
      title: entity.labels?.en?.value ?? search,
      pageUrl: entity.sitelinks?.enwiki?.url ?? `https://www.wikidata.org/wiki/${id}`,
      imageUrl,
      extract: entity.descriptions?.en?.value ?? null,
      source: "wikidata"
    };
  }

  return null;
}

async function queryCommonsImage(search) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: search,
    gsrlimit: "8",
    prop: "imageinfo|info",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "720",
    inprop: "url",
    format: "json",
    origin: "*"
  }).toString();

  const data = await fetchJson(url, "Wikimedia Commons lookup failed");
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const imageUrl = info?.thumburl ?? info?.url ?? null;
    const title = page.title?.replace(/^File:/i, "") ?? search;
    const extract = stripHtml(info.extmetadata?.ImageDescription?.value ?? info.extmetadata?.ObjectName?.value ?? "");
    if (!info?.mime?.startsWith("image/") || !isRelevantResult(search, title, extract ?? "") || !isUsableImageUrl(imageUrl, title)) continue;

    return {
      title,
      pageUrl: page.fullurl ?? null,
      imageUrl,
      extract,
      source: "wikimedia"
    };
  }

  return null;
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
    num: "3",
    safe: "active",
    imgSize: "large",
    fields: "items(title,link,image/contextLink,snippet)"
  }).toString();

  const data = await fetchJson(url, "Google image lookup failed");
  const item = data.items?.find((entry) => isUsableImageUrl(entry?.link, entry?.title));
  if (!item?.link) return null;

  return {
    title: item.title ?? null,
    pageUrl: item.image?.contextLink ?? null,
    imageUrl: item.link,
    extract: item.snippet ?? null,
    source: "google"
  };
}

async function queryNasaImage(search) {
  const url = new URL("https://images-api.nasa.gov/search");
  url.search = new URLSearchParams({
    q: search,
    media_type: "image",
    page_size: "8"
  }).toString();

  const data = await fetchJson(url, "NASA image lookup failed");
  const items = data.collection?.items ?? [];

  for (const item of items) {
    const imageUrl = item.links?.find((link) => link.render === "image" || link.rel === "preview")?.href ?? null;
    const metadata = item.data?.[0] ?? {};
    if (!isRelevantResult(search, metadata.title ?? "", metadata.description ?? "") || !isUsableImageUrl(imageUrl, metadata.title)) continue;

    return {
      title: metadata.title ?? search,
      pageUrl: item.href ?? null,
      imageUrl,
      extract: metadata.description ?? null,
      source: "nasa"
    };
  }

  return null;
}

function buildSearchQueries(name, type, norad) {
  const base = cleanObjectName(name);
  const compact = cleanQuery(base.replace(/\s+\((.*?)\)/g, " "));
  const withoutNumbers = cleanQuery(compact.replace(/\b\d{2,}[A-Z]?\b/gi, " ").replace(/[-_]+/g, " "));
  const typeWord = type === "rocket_body" ? "rocket body" : type === "debris" ? "space debris" : type === "unknown" ? "satellite" : "satellite";
  const queries = [];
  const add = (value) => {
    const clean = cleanQuery(value);
    if (clean.length > 2 && !queries.includes(clean)) queries.push(clean);
  };

  add(`${compact} spacecraft`);
  add(`${compact} ${typeWord}`);
  if (norad) add(`${compact} NORAD ${norad}`);
  add(compact);
  add(`${withoutNumbers} ${typeWord}`);
  add(withoutNumbers);
  for (const family of knownObjectFamilies(`${name} ${base}`)) add(family);

  if (type === "rocket_body") {
    add("rocket upper stage in orbit");
    add("spent rocket body space");
  } else if (type === "debris") {
    add("space debris Earth orbit");
    add("orbital debris satellite fragment");
  } else {
    add("artificial satellite in orbit");
    add("communications satellite spacecraft");
  }

  return queries;
}

function knownObjectFamilies(name) {
  const upper = name.toUpperCase();
  const families = [
    [/ISS|ZARYA/, "International Space Station"],
    [/TIANGONG|CSS/, "Tiangong space station"],
    [/STARLINK/, "Starlink satellite"],
    [/ONEWEB/, "OneWeb satellite"],
    [/IRIDIUM/, "Iridium satellite"],
    [/GPS|NAVSTAR/, "GPS satellite"],
    [/GALILEO/, "Galileo navigation satellite"],
    [/GLONASS/, "GLONASS satellite"],
    [/LANDSAT/, "Landsat satellite"],
    [/SENTINEL/, "Sentinel satellite"],
    [/HUBBLE|HST/, "Hubble Space Telescope"],
    [/NOAA/, "NOAA weather satellite"],
    [/GOES/, "GOES weather satellite"],
    [/TERRA/, "Terra satellite NASA"],
    [/AQUA/, "Aqua satellite NASA"],
    [/COSMOS|KOSMOS/, "Kosmos satellite"],
    [/FALCON/, "Falcon 9 second stage"],
    [/ARIANE/, "Ariane rocket upper stage"],
    [/ATLAS/, "Atlas rocket upper stage"],
    [/DELTA/, "Delta rocket upper stage"],
    [/SL-\d+/, "Soviet rocket body upper stage"]
  ];

  return families.filter(([pattern]) => pattern.test(upper)).map(([, query]) => query);
}

async function fetchJson(url, message) {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`${message}: ${response.status}`);
  }

  return response.json();
}

function cleanObjectName(value) {
  return value
    .replace(/\b(DEB|R\/B|AKM|OBJECT|TBA|UNKNOWN)\b/gi, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanQuery(value) {
  return value
    .replace(/[()"]/g, " ")
    .replace(/[-_]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsableImageUrl(url, title = "") {
  if (!url) return false;
  const text = decodeURIComponent(`${url} ${title}`).toLowerCase();
  if (!/^https:\/\//i.test(url)) return false;
  if (/\.(tif|tiff)(\?|$)/i.test(url)) return false;
  return !/(logo|wordmark|seal|flag|coat of arms|emblem|icon|map|diagram|chart|graph|scheme|schematic|svg)/i.test(text);
}

function isRelevantResult(search, title, description = "") {
  const terms = importantTerms(search);
  if (!terms.length) return false;

  const titleText = normalizeSearchText(title);
  const bodyText = normalizeSearchText(`${title} ${description}`);
  const titleHit = terms.some((term) => titleText.includes(term));
  const bodyHits = terms.filter((term) => bodyText.includes(term)).length;

  return titleHit || bodyHits >= Math.min(2, terms.length);
}

function importantTerms(value) {
  const stop = new Set([
    "and",
    "body",
    "earth",
    "fake",
    "in",
    "norad",
    "object",
    "orbit",
    "rocket",
    "satellite",
    "satellites",
    "second",
    "space",
    "spacecraft",
    "stage",
    "the",
    "this",
    "upper"
  ]);

  return normalizeSearchText(value)
    .split(" ")
    .filter((term) => term.length > 2 && !stop.has(term))
    .slice(0, 5);
}

function normalizeSearchText(value) {
  return value
    .toLowerCase()
    .replace(/kosmos/g, "cosmos")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function commonsFilePath(fileName) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=720`;
}

function stripHtml(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim() || null;
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
