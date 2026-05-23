const EARTH_RADIUS_KM = 6378.137;
const MU = 398600.4418;

export const groupPresets = {
  focused: ["stations", "active", "starlink", "oneweb", "geo"],
  wide: [
    "stations",
    "active",
    "starlink",
    "oneweb",
    "geo",
    "last-30-days",
    "iridium-33-debris",
    "cosmos-2251-debris",
    "fengyun-1c-debris",
    "cosmos-1408-debris"
  ],
  debris: ["iridium-33-debris", "cosmos-2251-debris", "fengyun-1c-debris", "cosmos-1408-debris"],
  constellations: ["starlink", "oneweb", "iridium", "globalstar", "orbcomm", "planet", "spire"],
  deep: ["geo", "intelsat", "ses", "eutelsat", "telesat", "beidou", "galileo", "gps-ops", "glo-ops"],
  complete: [
    "stations",
    "active",
    "last-30-days",
    "geo",
    "cubesat",
    "starlink",
    "oneweb",
    "iridium",
    "globalstar",
    "orbcomm",
    "planet",
    "spire",
    "gps-ops",
    "glo-ops",
    "galileo",
    "beidou",
    "sbas",
    "weather",
    "noaa",
    "goes",
    "resource",
    "science",
    "geodetic",
    "engineering",
    "education",
    "military",
    "radar",
    "amateur",
    "x-comm",
    "other-comm",
    "satnogs",
    "gorizont",
    "raduga",
    "molniya",
    "iridium-33-debris",
    "cosmos-2251-debris",
    "fengyun-1c-debris",
    "cosmos-1408-debris"
  ]
};

export function pickGroups(preset = "wide") {
  return groupPresets[preset] ?? groupPresets.wide;
}

export function parseTleCatalog(text, group, source) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const objects = [];

  for (let index = 0; index < rows.length; index += 1) {
    const name = rows[index];
    const line1 = rows[index + 1];
    const line2 = rows[index + 2];

    if (!line1?.startsWith("1 ") || !line2?.startsWith("2 ")) {
      continue;
    }

    objects.push(createObjectFromTle(name, line1, line2, group, source));
    index += 2;
  }

  return objects;
}

export function mergeCatalogs(catalogs, limit = 18000) {
  const byId = new Map();

  for (const item of catalogs.flat()) {
    const existing = byId.get(item.noradId);

    if (!existing) {
      byId.set(item.noradId, item);
      continue;
    }

    const groups = Array.from(new Set([...existing.groups, ...item.groups]));
    byId.set(item.noradId, {
      ...existing,
      groups,
      objectType: rankObjectType(item.objectType) < rankObjectType(existing.objectType) ? item.objectType : existing.objectType,
      source: existing.source === item.source ? existing.source : `${existing.source}, ${item.source}`
    });
  }

  return Array.from(byId.values())
    .sort((a, b) => rankObjectType(a.objectType) - rankObjectType(b.objectType) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function createObjectFromTle(name, line1, line2, group, source) {
  const parts = line2.split(/\s+/);
  const meanMotion = Number(parts[7]) || 0;
  const eccentricity = Number(`0.${parts[4] ?? "0"}`);
  const inclination = Number(parts[2]) || 0;
  const periodMinutes = meanMotion > 0 ? 1440 / meanMotion : null;
  const semiMajorAxisKm = meanMotion > 0 ? semiMajorAxisFromMeanMotion(meanMotion) : null;
  const apogeeKm = semiMajorAxisKm ? semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM : null;
  const perigeeKm = semiMajorAxisKm ? semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM : null;
  const noradId = line1.slice(2, 7).trim();
  const intlDesignator = line1.slice(9, 17).trim() || null;
  const epoch = parseTleEpoch(line1);
  const launchYear = parseLaunchYear(intlDesignator);
  const objectType = inferObjectType(name, group);

  return {
    id: noradId,
    noradId,
    name: cleanName(name),
    intlDesignator,
    objectType,
    groups: [group],
    source,
    tle1: line1,
    tle2: line2,
    epoch,
    meanMotion,
    inclination,
    eccentricity,
    apogeeKm,
    perigeeKm,
    periodMinutes,
    launchYear,
    bstar: parseBstar(line1),
    isActive: group === "active" || group === "stations" || objectType === "payload"
  };
}

function semiMajorAxisFromMeanMotion(meanMotionRevsPerDay) {
  const radiansPerSecond = (meanMotionRevsPerDay * Math.PI * 2) / 86400;
  return Math.cbrt(MU / (radiansPerSecond * radiansPerSecond));
}

function parseTleEpoch(line1) {
  const yearPart = Number(line1.slice(18, 20));
  const dayOfYear = Number(line1.slice(20, 32));

  if (!Number.isFinite(yearPart) || !Number.isFinite(dayOfYear)) {
    return null;
  }

  const year = yearPart < 57 ? 2000 + yearPart : 1900 + yearPart;
  const date = new Date(Date.UTC(year, 0, 1));
  date.setUTCDate(1);
  date.setUTCSeconds((dayOfYear - 1) * 86400);
  return date.toISOString();
}

function parseLaunchYear(intlDesignator) {
  if (!intlDesignator || intlDesignator.length < 2) {
    return null;
  }

  const year = Number(intlDesignator.slice(0, 2));
  if (!Number.isFinite(year)) {
    return null;
  }

  return year < 57 ? 2000 + year : 1900 + year;
}

function parseBstar(line1) {
  const raw = line1.slice(53, 61).trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^([ +-]?)(\d{5})([+-]\d)$/);
  if (!match) {
    return null;
  }

  const sign = match[1] === "-" ? -1 : 1;
  return sign * Number(`0.${match[2]}`) * 10 ** Number(match[3]);
}

function cleanName(name) {
  return name.replace(/^0\s+/, "").replace(/\s+/g, " ").trim();
}

function inferObjectType(name, group) {
  const value = `${name} ${group}`.toLowerCase();

  if (value.includes("debris") || /\bdeb\b/.test(value)) {
    return "debris";
  }

  if (value.includes("r/b") || value.includes("rocket body")) {
    return "rocket_body";
  }

  if (group === "active" || group === "stations" || value.includes("starlink") || value.includes("oneweb")) {
    return "payload";
  }

  return "unknown";
}

function rankObjectType(type) {
  return {
    payload: 0,
    rocket_body: 1,
    debris: 2,
    unknown: 3
  }[type] ?? 4;
}
