import * as satellite from "satellite.js";
import type { LocationTarget, OrbitObject, PassPrediction } from "../types";
import { EARTH_RADIUS_KM, formatDecimal, formatKm } from "./orbitMath";

interface KnownLocation extends LocationTarget {
  aliases: string[];
}

const knownLocations: KnownLocation[] = [
  knownLocation("Mountain View, California", 37.3861, -122.0839, 0.032, ["mountain view ca", "mountain view"]),
  knownLocation("San Jose, California", 37.3382, -121.8863, 0.026, ["san jose ca", "san jose california", "san jose"]),
  knownLocation("San Francisco, California", 37.7749, -122.4194, 0.016, ["san francisco ca", "sf california", "san francisco", "sf"]),
  knownLocation("Los Angeles, California", 34.0522, -118.2437, 0.071, ["los angeles ca", "la california", "los angeles", "la"]),
  knownLocation("San Diego, California", 32.7157, -117.1611, 0.019, ["san diego ca", "san diego"]),
  knownLocation("Sacramento, California", 38.5816, -121.4944, 0.009, ["sacramento ca", "sacramento"]),
  knownLocation("New York, New York", 40.7128, -74.006, 0.01, ["new york city", "new york ny", "nyc", "new york"]),
  knownLocation("Houston, Texas", 29.7604, -95.3698, 0.013, ["houston tx", "houston"]),
  knownLocation("Dallas, Texas", 32.7767, -96.797, 0.131, ["dallas tx", "dallas"]),
  knownLocation("Austin, Texas", 30.2672, -97.7431, 0.149, ["austin tx", "austin"]),
  knownLocation("Chicago, Illinois", 41.8781, -87.6298, 0.181, ["chicago il", "chicago"]),
  knownLocation("Seattle, Washington", 47.6062, -122.3321, 0.052, ["seattle wa", "seattle"]),
  knownLocation("Portland, Oregon", 45.5152, -122.6784, 0.015, ["portland or", "portland oregon"]),
  knownLocation("Denver, Colorado", 39.7392, -104.9903, 1.609, ["denver co", "denver"]),
  knownLocation("Phoenix, Arizona", 33.4484, -112.074, 0.331, ["phoenix az", "phoenix"]),
  knownLocation("Miami, Florida", 25.7617, -80.1918, 0.002, ["miami fl", "miami"]),
  knownLocation("Atlanta, Georgia", 33.749, -84.388, 0.32, ["atlanta ga", "atlanta"]),
  knownLocation("Boston, Massachusetts", 42.3601, -71.0589, 0.043, ["boston ma", "boston"]),
  knownLocation("Washington, DC", 38.9072, -77.0369, 0.007, ["washington dc", "washington d c", "dc"]),
  knownLocation("Kennedy Space Center, Florida", 28.5729, -80.649, 0.003, ["kennedy space center", "ksc", "cape canaveral"]),
  knownLocation("Toronto, Canada", 43.6532, -79.3832, 0.076, ["toronto ontario", "toronto"]),
  knownLocation("Vancouver, Canada", 49.2827, -123.1207, 0.07, ["vancouver bc", "vancouver canada"]),
  knownLocation("London, United Kingdom", 51.5072, -0.1276, 0.011, ["london uk", "london england", "london"]),
  knownLocation("Paris, France", 48.8566, 2.3522, 0.035, ["paris france", "paris"]),
  knownLocation("Berlin, Germany", 52.52, 13.405, 0.034, ["berlin germany", "berlin"]),
  knownLocation("Tokyo, Japan", 35.6762, 139.6503, 0.04, ["tokyo japan", "tokyo"]),
  knownLocation("Singapore", 1.3521, 103.8198, 0.015, ["singapore"]),
  knownLocation("Sydney, Australia", -33.8688, 151.2093, 0.058, ["sydney australia", "sydney"]),
  knownLocation("Mumbai, India", 19.076, 72.8777, 0.014, ["mumbai india", "mumbai"]),
  knownLocation("Kathmandu, Nepal", 27.7172, 85.324, 1.4, ["kathmandu nepal", "kathmandu"])
];

export function parseLocationQuery(input: string): LocationTarget | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  const coordinateMatch = value.match(/(-?\d+(?:\.\d+)?)\s*(?:,\s*|\s+)(-?\d+(?:\.\d+)?)/);
  if (coordinateMatch) {
    const latitude = Number(coordinateMatch[1]);
    const longitude = Number(coordinateMatch[2]);

    if (isValidLatitude(latitude) && isValidLongitude(longitude)) {
      return {
        name: `${formatDecimal(latitude, 4)}, ${formatDecimal(longitude, 4)}`,
        latitude,
        longitude,
        altitudeKm: 0
      };
    }
  }

  const candidates = extractLocationCandidates(value);
  const match = knownLocations.find((location) => location.aliases.some((alias) => candidates.some((candidate) => candidate.includes(alias))));

  return match ? toLocationTarget(match) : null;
}

export function isLocationPassQuery(input: string) {
  const value = input.toLowerCase();
  return /\b(when|next|pass|over|visible|flyover|above|near)\b/.test(value) && Boolean(parseLocationQuery(input));
}

function knownLocation(name: string, latitude: number, longitude: number, altitudeKm: number, aliases: string[]): KnownLocation {
  const baseAliases = [name, name.split(",")[0], ...aliases].map(normalizeLocationText);
  return {
    name,
    latitude,
    longitude,
    altitudeKm,
    aliases: Array.from(new Set(baseAliases)).sort((a, b) => b.length - a.length)
  };
}

function toLocationTarget(location: KnownLocation): LocationTarget {
  return {
    name: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    altitudeKm: location.altitudeKm
  };
}

function extractLocationCandidates(value: string) {
  const normalized = normalizeLocationText(value);
  const candidates = [normalized];
  const patterns = [
    /\b(?:over|above|near|from|for|at|in)\s+(.+)$/,
    /\b(?:visible|flyover|pass)\s+(?:over|above|near|from|for|at|in)?\s*(.+)$/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) candidates.push(cleanLocationCandidate(match[1]));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function cleanLocationCandidate(value: string) {
  return value
    .replace(/\b(today|tomorrow|tonight|please|next|this|object|satellite|spacecraft|pass|passes|visible|visibility)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocationText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.\-\s]/g, " ")
    .replace(/\bcalifornia\b/g, "ca")
    .replace(/\btexas\b/g, "tx")
    .replace(/\bflorida\b/g, "fl")
    .replace(/\bwashington\b/g, "wa")
    .replace(/\billinois\b/g, "il")
    .replace(/\barizona\b/g, "az")
    .replace(/\bgeorgia\b/g, "ga")
    .replace(/\bcolorado\b/g, "co")
    .replace(/\boregon\b/g, "or")
    .replace(/\bmassachusetts\b/g, "ma")
    .replace(/\s+/g, " ")
    .trim();
}

export function predictPassForLocation(
  object: OrbitObject,
  fromDate: Date,
  location: LocationTarget,
  horizonHours = 72,
  minElevationDeg = 10
): PassPrediction {
  const satrec = satellite.twoline2satrec(object.tle1, object.tle2);
  const stepMs = 60_000;
  const samples = Math.ceil((horizonHours * 60 * 60 * 1000) / stepMs);
  let best: PassSample | null = null;
  let active: { start: Date; peak: PassSample } | null = null;

  for (let index = 0; index <= samples; index += 1) {
    const date = new Date(fromDate.getTime() + index * stepMs);
    const sample = createPassSample(satrec, date, location);

    if (!sample) continue;
    if (!best || sample.peakScore > best.peakScore) best = sample;

    if (sample.peakElevationDeg >= minElevationDeg) {
      if (!active) active = { start: date, peak: sample };
      if (sample.peakElevationDeg > active.peak.peakElevationDeg) active.peak = sample;
      continue;
    }

    if (active) {
      const refined = refinePeak(satrec, active.peak.date, location);
      return buildPrediction("visible", location, refined ?? active.peak, active.start, date);
    }
  }

  if (active) {
    const refined = refinePeak(satrec, active.peak.date, location);
    return buildPrediction("visible", location, refined ?? active.peak, active.start, null);
  }

  if (best) {
    return buildPrediction("below_horizon", location, best, null, null);
  }

  return {
    status: "unavailable",
    location,
    peakTime: fromDate.toISOString(),
    startTime: null,
    endTime: null,
    peakElevationDeg: 0,
    azimuthDeg: 0,
    rangeKm: 0,
    subpointDistanceKm: 0,
    altitudeKm: 0,
    summary: `No usable propagated pass could be computed for ${location.name}.`
  };
}

function refinePeak(satrec: satellite.SatRec, peakDate: Date, location: LocationTarget) {
  let best: PassSample | null = null;

  for (let offsetMs = -90_000; offsetMs <= 90_000; offsetMs += 5_000) {
    const sample = createPassSample(satrec, new Date(peakDate.getTime() + offsetMs), location);
    if (!sample) continue;
    if (!best || sample.peakScore > best.peakScore) best = sample;
  }

  return best;
}

function createPassSample(satrec: satellite.SatRec, date: Date, location: LocationTarget): PassSample | null {
  const propagated = satellite.propagate(satrec, date);

  if (!propagated || !propagated.position || typeof propagated.position === "boolean") {
    return null;
  }

  const position = propagated.position;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(position, gmst);
  const observer = {
    latitude: satellite.degreesToRadians(location.latitude),
    longitude: satellite.degreesToRadians(location.longitude),
    height: location.altitudeKm ?? 0
  };
  const look = satellite.ecfToLookAngles(observer, ecf);
  const geodetic = satellite.eciToGeodetic(position, gmst);
  const subpointLatitude = satellite.degreesLat(geodetic.latitude);
  const subpointLongitude = satellite.degreesLong(geodetic.longitude);
  const subpointDistanceKm = haversineKm(location.latitude, location.longitude, subpointLatitude, subpointLongitude);
  const altitudeKm = Math.hypot(position.x, position.y, position.z) - EARTH_RADIUS_KM;
  const peakElevationDeg = satellite.radiansToDegrees(look.elevation);

  return {
    date,
    peakElevationDeg,
    azimuthDeg: normalizeDegrees(satellite.radiansToDegrees(look.azimuth)),
    rangeKm: look.rangeSat,
    subpointDistanceKm,
    altitudeKm,
    peakScore: peakElevationDeg * 6 - subpointDistanceKm / 80
  };
}

function buildPrediction(
  status: PassPrediction["status"],
  location: LocationTarget,
  sample: PassSample,
  start: Date | null,
  end: Date | null
): PassPrediction {
  const visible = status === "visible";
  const summary = visible
    ? `Next visible pass over ${location.name} peaks at ${sample.date.toLocaleString()} with ${formatDecimal(sample.peakElevationDeg, 1)} degrees elevation.`
    : `No visible pass was found in the next 72 hours. Closest modeled opportunity is ${sample.date.toLocaleString()} at ${formatKm(sample.subpointDistanceKm)} ground-track distance.`;

  return {
    status,
    location,
    peakTime: sample.date.toISOString(),
    startTime: start?.toISOString() ?? null,
    endTime: end?.toISOString() ?? null,
    peakElevationDeg: sample.peakElevationDeg,
    azimuthDeg: sample.azimuthDeg,
    rangeKm: sample.rangeKm,
    subpointDistanceKm: sample.subpointDistanceKm,
    altitudeKm: sample.altitudeKm,
    summary
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = satellite.degreesToRadians(lat2 - lat1);
  const dLon = satellite.degreesToRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(satellite.degreesToRadians(lat1)) *
      Math.cos(satellite.degreesToRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

interface PassSample {
  date: Date;
  peakElevationDeg: number;
  azimuthDeg: number;
  rangeKm: number;
  subpointDistanceKm: number;
  altitudeKm: number;
  peakScore: number;
}
