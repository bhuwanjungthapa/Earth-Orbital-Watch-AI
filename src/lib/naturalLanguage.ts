import type { NaturalLanguageIntent, ObjectType, OrbitClass, PropagatedOrbitObject } from "../types";

const emptyIntent: NaturalLanguageIntent = {
  objectTypes: [],
  orbitClasses: [],
  textTokens: [],
  requiredTokens: [],
  beforeYear: null,
  afterYear: null,
  anomalyOnly: false,
  highRiskOnly: false,
  activeOnly: null,
  minAltitudeKm: null,
  maxAltitudeKm: null
};

export function parseNaturalLanguageIntent(input: string): NaturalLanguageIntent {
  const value = input.trim().toLowerCase();

  if (!value) {
    return emptyIntent;
  }

  const objectTypes = new Set<ObjectType>();
  const orbitClasses = new Set<OrbitClass>();
  const textTokens = new Set<string>();
  const requiredTokens = new Set<string>();

  if (/\b(debris|fragment|fragments|junk)\b/.test(value)) objectTypes.add("debris");
  if (/\b(rocket|booster|r\/b|upper stage)\b/.test(value)) objectTypes.add("rocket_body");
  if (/\b(payload|satellite|satellites|spacecraft|space craft)\b/.test(value)) objectTypes.add("payload");
  if (/\bunknown\b/.test(value)) objectTypes.add("unknown");

  if (/\b(leo|low earth|low-earth)\b/.test(value)) orbitClasses.add("LEO");
  if (/\b(meo|medium earth|navigation orbit)\b/.test(value)) orbitClasses.add("MEO");
  if (/\b(geo|geo location|geolocation|geosynchronous|geostationary|geostationary orbit)\b/.test(value)) orbitClasses.add("GEO");
  if (/\b(heo|molniya|highly elliptical|elliptical)\b/.test(value)) orbitClasses.add("HEO");
  if (/\bdeep\b/.test(value)) orbitClasses.add("Deep");

  for (const token of ["starlink", "oneweb", "cosmos", "kosmos", "fengyun", "iridium", "goes", "noaa", "gps", "navstar", "galileo", "beidou", "landsat", "sentinel", "hubble", "skynet"]) {
    if (value.includes(token)) textTokens.add(token);
  }

  addCountryTokens(value, textTokens, requiredTokens);
  addFreeTextTokens(value, requiredTokens);

  const beforeYear = matchYear(value, /\b(before|older than|pre)\s+(\d{4})/);
  const afterYear = matchYear(value, /\b(after|since|newer than|post)\s+(\d{4})/);
  const lowerAltitude = matchNumber(value, /\b(above|over|higher than)\s+(\d{2,6})\s*(km|kilometers)?/);
  const upperAltitude = matchNumber(value, /\b(below|under|lower than)\s+(\d{2,6})\s*(km|kilometers)?/);

  return {
    objectTypes: Array.from(objectTypes),
    orbitClasses: Array.from(orbitClasses),
    textTokens: Array.from(textTokens),
    requiredTokens: Array.from(requiredTokens),
    beforeYear,
    afterYear,
    anomalyOnly: /\b(anomaly|anomalies|unusual|decay|drag|watch)\b/.test(value),
    highRiskOnly: /\b(risk|risky|collision|crowded|close approach|proximity)\b/.test(value),
    activeOnly: /\b(active|operational)\b/.test(value) ? true : /\b(inactive|dead|retired)\b/.test(value) ? false : null,
    minAltitudeKm: lowerAltitude,
    maxAltitudeKm: upperAltitude
  };
}

export function applyNaturalLanguageIntent(objects: PropagatedOrbitObject[], intent: NaturalLanguageIntent) {
  if (intent === emptyIntent) {
    return objects;
  }

  return objects.filter((object) => {
    if (intent.objectTypes.length && !intent.objectTypes.includes(object.objectType)) return false;
    if (intent.orbitClasses.length && !intent.orbitClasses.includes(object.orbitClass)) return false;
    if (intent.beforeYear && (!object.launchYear || object.launchYear >= intent.beforeYear)) return false;
    if (intent.afterYear && (!object.launchYear || object.launchYear <= intent.afterYear)) return false;
    if (intent.activeOnly !== null && object.isActive !== intent.activeOnly) return false;
    if (intent.anomalyOnly && object.anomalyScore < 0.35) return false;
    if (intent.highRiskOnly && object.riskScore < 0.42) return false;
    if (intent.minAltitudeKm !== null && object.altitudeKm < intent.minAltitudeKm) return false;
    if (intent.maxAltitudeKm !== null && object.altitudeKm > intent.maxAltitudeKm) return false;

    if (intent.textTokens.length) {
      const haystack = `${object.name} ${object.groups.join(" ")} ${object.source}`.toLowerCase();
      if (!intent.textTokens.some((token) => haystack.includes(token))) return false;
    }

    if (intent.requiredTokens.length) {
      const haystack = normalizeSearchText(`${object.name} ${object.noradId} ${object.intlDesignator ?? ""} ${object.groups.join(" ")} ${object.source} ${object.objectType} ${object.orbitClass}`);
      return intent.requiredTokens.every((token) => haystack.includes(token));
    }

    return true;
  });
}

function addCountryTokens(value: string, textTokens: Set<string>, requiredTokens: Set<string>) {
  const countries: Array<[RegExp, string[]]> = [
    [/\b(uk|u\.k\.|united kingdom|british|britain|england)\b/, ["uk", "british", "skynet", "oneweb", "dmc"]],
    [/\b(us|usa|u\.s\.|american|united states|america)\b/, ["usa", "starlink", "goes", "noaa", "gps", "navstar", "landsat", "hubble"]],
    [/\b(russian|russia|soviet|ussr|roscosmos)\b/, ["cosmos", "kosmos", "glonass", "molniya"]],
    [/\b(chinese|china|prc|cnsa)\b/, ["fengyun", "beidou", "yaogan", "tiangong", "shijian"]],
    [/\b(europe|european|esa)\b/, ["sentinel", "galileo", "metop", "eutelsat"]],
    [/\b(india|indian|isro)\b/, ["insat", "cartosat", "risat", "gsat", "irs"]],
    [/\b(japan|japanese|jaxa)\b/, ["himawari", "alos", "qzss", "gms"]],
    [/\b(canada|canadian)\b/, ["radarsat", "anik", "scisat"]],
    [/\b(france|french)\b/, ["spot", "pleiades", "helios", "eutelsat"]],
    [/\b(germany|german)\b/, ["terrasar", "tandem", "sar-lupe"]],
    [/\b(korea|korean|south korea)\b/, ["kompsat", "koreasat"]],
    [/\b(brazil|brazilian)\b/, ["cbers", "amazonas", "satec"]],
    [/\b(turkey|turkish)\b/, ["turksat", "gokturk"]]
  ];

  for (const [pattern, tokens] of countries) {
    if (!pattern.test(value)) continue;
    for (const token of tokens) textTokens.add(normalizeSearchText(token));
  }

  const quoted = value.match(/["']([^"']{3,})["']/)?.[1];
  if (quoted) requiredTokens.add(normalizeSearchText(quoted));
}

function addFreeTextTokens(value: string, requiredTokens: Set<string>) {
  const stopWords = new Set([
    "all",
    "america",
    "american",
    "and",
    "are",
    "britain",
    "british",
    "canada",
    "canadian",
    "china",
    "chinese",
    "find",
    "for",
    "france",
    "french",
    "give",
    "germany",
    "german",
    "india",
    "indian",
    "japan",
    "japanese",
    "kingdom",
    "korea",
    "korean",
    "list",
    "location",
    "me",
    "object",
    "objects",
    "orbit",
    "satellite",
    "satellites",
    "show",
    "space",
    "spacecraft",
    "that",
    "the",
    "russia",
    "russian",
    "states",
    "uk",
    "united",
    "usa",
    "with"
  ]);

  const tokens = normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !stopWords.has(token));

  if (tokens.length === 1 && !/^(geo|leo|meo|heo|deep|debris|rocket|payload|active|risk|risky|anomaly|operational)$/.test(tokens[0])) {
    requiredTokens.add(tokens[0]);
  }
}

function matchYear(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  const year = match ? Number(match[2]) : null;
  return year && year > 1956 && year < 2100 ? year : null;
}

function matchNumber(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  const number = match ? Number(match[2]) : null;
  return number && number > 0 ? number : null;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/r\/b/g, "rocket body")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
