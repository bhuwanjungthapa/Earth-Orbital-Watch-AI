import type { NaturalLanguageIntent, ObjectType, OrbitClass, PropagatedOrbitObject } from "../types";

const emptyIntent: NaturalLanguageIntent = {
  objectTypes: [],
  orbitClasses: [],
  textTokens: [],
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

  if (/\b(debris|fragment|fragments|junk)\b/.test(value)) objectTypes.add("debris");
  if (/\b(rocket|booster|r\/b|upper stage)\b/.test(value)) objectTypes.add("rocket_body");
  if (/\b(payload|satellite|satellites|spacecraft)\b/.test(value)) objectTypes.add("payload");
  if (/\bunknown\b/.test(value)) objectTypes.add("unknown");

  if (/\b(leo|low earth|low-earth)\b/.test(value)) orbitClasses.add("LEO");
  if (/\b(meo|medium earth|navigation orbit)\b/.test(value)) orbitClasses.add("MEO");
  if (/\b(geo|geosynchronous|geostationary)\b/.test(value)) orbitClasses.add("GEO");
  if (/\b(heo|molniya|highly elliptical|elliptical)\b/.test(value)) orbitClasses.add("HEO");
  if (/\bdeep\b/.test(value)) orbitClasses.add("Deep");

  for (const token of ["starlink", "oneweb", "cosmos", "fengyun", "iridium", "goes", "noaa", "gps", "galileo", "beidou"]) {
    if (value.includes(token)) textTokens.add(token);
  }

  if (/\b(russian|russia|soviet|ussr)\b/.test(value)) textTokens.add("cosmos");
  if (/\b(chinese|china|prc)\b/.test(value)) textTokens.add("fengyun");
  if (/\b(american|usa|u\.s\.|united states)\b/.test(value)) {
    textTokens.add("starlink");
    textTokens.add("goes");
    textTokens.add("noaa");
  }

  const beforeYear = matchYear(value, /\b(before|older than|pre)\s+(\d{4})/);
  const afterYear = matchYear(value, /\b(after|since|newer than|post)\s+(\d{4})/);
  const lowerAltitude = matchNumber(value, /\b(above|over|higher than)\s+(\d{2,6})\s*(km|kilometers)?/);
  const upperAltitude = matchNumber(value, /\b(below|under|lower than)\s+(\d{2,6})\s*(km|kilometers)?/);

  return {
    objectTypes: Array.from(objectTypes),
    orbitClasses: Array.from(orbitClasses),
    textTokens: Array.from(textTokens),
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
      return intent.textTokens.some((token) => haystack.includes(token));
    }

    return true;
  });
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
