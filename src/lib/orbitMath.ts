import * as satellite from "satellite.js";
import type {
  AnomalyResult,
  ClassificationResult,
  OrbitClass,
  OrbitObject,
  PropagatedOrbitObject,
  Vector3Tuple
} from "../types";

export const EARTH_RADIUS_KM = 6378.137;

export function classifyOrbit(object: OrbitObject): ClassificationResult {
  const perigee = object.perigeeKm;
  const apogee = object.apogeeKm;
  const period = object.periodMinutes;
  const eccentricity = object.eccentricity;
  const reasons: string[] = [];

  if (perigee === null || apogee === null || period === null) {
    return {
      orbitClass: "Unknown",
      confidence: 0.25,
      reasons: ["Missing orbital dimensions from the current element set."]
    };
  }

  if (period > 900 || apogee > 50000 || eccentricity > 0.25) {
    reasons.push(`High eccentricity/apogee pattern: e=${formatDecimal(eccentricity, 3)}, apogee=${formatKm(apogee)}.`);
    return { orbitClass: "HEO", confidence: 0.92, reasons };
  }

  if (Math.abs(period - 1436) < 90 || Math.abs(apogee - 35786) < 1800 || Math.abs(perigee - 35786) < 1800) {
    reasons.push(`Near-geosynchronous period/altitude: period=${formatDecimal(period, 1)} min.`);
    return { orbitClass: "GEO", confidence: 0.9, reasons };
  }

  if (apogee <= 2000) {
    reasons.push(`Apogee sits inside the low Earth band at ${formatKm(apogee)}.`);
    return { orbitClass: "LEO", confidence: 0.95, reasons };
  }

  if (perigee > 2000 && apogee < 35786) {
    reasons.push(`Orbit remains between LEO and GEO: ${formatKm(perigee)} to ${formatKm(apogee)}.`);
    return { orbitClass: "MEO", confidence: 0.88, reasons };
  }

  if (apogee >= 35786) {
    reasons.push(`Apogee reaches deep-space altitude at ${formatKm(apogee)}.`);
    return { orbitClass: "Deep", confidence: 0.72, reasons };
  }

  reasons.push("The current elements sit near a boundary between common orbit regimes.");
  return { orbitClass: "Unknown", confidence: 0.45, reasons };
}

export function scoreAnomaly(object: OrbitObject, altitudeKm: number, staleDays: number | null): AnomalyResult {
  const flags: string[] = [];
  const reasons: string[] = [];
  let score = 0;

  if (object.perigeeKm !== null && object.perigeeKm < 250) {
    score += 0.32;
    flags.push("low-perigee");
    reasons.push(`Perigee is very low at ${formatKm(object.perigeeKm)}.`);
  }

  if (object.eccentricity > 0.08) {
    score += Math.min(0.28, object.eccentricity * 0.9);
    flags.push("eccentric");
    reasons.push(`Eccentricity is elevated at ${formatDecimal(object.eccentricity, 4)}.`);
  }

  if (Math.abs(object.bstar ?? 0) > 0.01) {
    score += 0.2;
    flags.push("drag-sensitive");
    reasons.push("BSTAR drag proxy is elevated in the current TLE.");
  }

  if (staleDays !== null && staleDays > 7) {
    score += Math.min(0.25, staleDays / 60);
    flags.push("stale-elements");
    reasons.push(`Element epoch is ${formatDecimal(staleDays, 1)} days old.`);
  }

  if (object.objectType === "debris") {
    score += 0.14;
    flags.push("debris");
    reasons.push("Debris objects receive a higher watch score.");
  }

  if (object.objectType === "rocket_body") {
    score += 0.1;
    flags.push("rocket-body");
    reasons.push("Rocket bodies receive a moderate watch score.");
  }

  if (altitudeKm < 180) {
    score += 0.28;
    flags.push("decay-watch");
    reasons.push(`Current propagated altitude is ${formatKm(altitudeKm)}.`);
  }

  return {
    score: clamp01(score),
    flags: Array.from(new Set(flags)),
    reasons: reasons.length ? reasons : ["No unusual orbital indicators were detected from the selected features."]
  };
}

export function propagateCatalog(objects: OrbitObject[], date: Date): PropagatedOrbitObject[] {
  const propagated = objects
    .map((object) => propagateObject(object, date))
    .filter((object): object is PropagatedOrbitObject => Boolean(object));

  return addCrowdingRisk(propagated);
}

export function propagateObject(object: OrbitObject, date: Date): PropagatedOrbitObject | null {
  try {
    const normalizedObject = {
      ...object,
      objectType: normalizeObjectType(object)
    };
    const satrec = satellite.twoline2satrec(object.tle1, object.tle2);
    const positionAndVelocity = satellite.propagate(satrec, date);

    if (!positionAndVelocity || !positionAndVelocity.position || typeof positionAndVelocity.position === "boolean") {
      return null;
    }

    const velocity = typeof positionAndVelocity.velocity === "boolean" ? null : positionAndVelocity.velocity;
    const position = positionAndVelocity.position;
    const eciKm: Vector3Tuple = [position.x, position.y, position.z];
    const radiusKm = vectorLength(eciKm);
    const altitudeKm = radiusKm - EARTH_RADIUS_KM;
    const scenePosition = eciToScenePosition(eciKm);
    const gmst = satellite.gstime(date);
    const geodetic = satellite.eciToGeodetic(position, gmst);
    const staleDays = object.epoch ? Math.abs(date.getTime() - new Date(object.epoch).getTime()) / 86400000 : null;
    const classification = classifyOrbit(normalizedObject);
    const anomaly = scoreAnomaly(normalizedObject, altitudeKm, staleDays);

    return {
      ...normalizedObject,
      eciKm,
      scenePosition,
      latitude: satellite.degreesLat(geodetic.latitude),
      longitude: satellite.degreesLong(geodetic.longitude),
      altitudeKm,
      velocityKms: velocity ? vectorLength([velocity.x, velocity.y, velocity.z]) : 0,
      orbitClass: classification.orbitClass,
      classificationConfidence: classification.confidence,
      classificationReasons: classification.reasons,
      anomalyScore: anomaly.score,
      anomalyFlags: anomaly.flags,
      anomalyReasons: anomaly.reasons,
      riskScore: 0,
      staleDays
    };
  } catch {
    return null;
  }
}

function normalizeObjectType(object: OrbitObject) {
  const value = `${object.name} ${object.groups.join(" ")}`.toLowerCase();

  if (value.includes("debris") || /\bdeb\b/.test(value)) return "debris";
  if (value.includes("r/b") || value.includes("rocket body")) return "rocket_body";
  if (
    value.includes("stations") ||
    value.includes("active") ||
    value.includes("featured") ||
    value.includes("hst") ||
    value.includes("hubble") ||
    value.includes("starlink") ||
    value.includes("oneweb") ||
    value.includes("payload") ||
    value.includes("cubesat")
  ) {
    return "payload";
  }

  return object.objectType;
}

export function eciToScenePosition(eciKm: Vector3Tuple): Vector3Tuple {
  const radiusKm = vectorLength(eciKm);
  const altitudeKm = Math.max(0, radiusKm - EARTH_RADIUS_KM);
  const unit: Vector3Tuple = [eciKm[0] / radiusKm, eciKm[1] / radiusKm, eciKm[2] / radiusKm];
  const sceneRadius = altitudeToSceneRadius(altitudeKm);

  return [unit[0] * sceneRadius, unit[2] * sceneRadius, -unit[1] * sceneRadius];
}

export function altitudeToSceneRadius(altitudeKm: number) {
  return 1 + Math.log1p(Math.max(0, altitudeKm) / 320) * 0.38;
}

export function createOrbitTrail(object: OrbitObject, date: Date, samples = 180): Vector3Tuple[] {
  const periodMinutes = object.periodMinutes ?? 96;
  const stepMs = (periodMinutes * 60 * 1000) / samples;
  const points: Vector3Tuple[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const sampleDate = new Date(date.getTime() + stepMs * index);
    const sample = propagateObject(object, sampleDate);

    if (sample) {
      points.push(sample.scenePosition);
    }
  }

  return points;
}

export function findNearestObjects(
  selected: PropagatedOrbitObject | null,
  objects: PropagatedOrbitObject[],
  count = 6
) {
  if (!selected) {
    return [];
  }

  return objects
    .filter((object) => object.noradId !== selected.noradId)
    .map((object) => ({
      object,
      distanceKm: distanceKm(selected.eciKm, object.eciKm)
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, count);
}

function addCrowdingRisk(objects: PropagatedOrbitObject[]): PropagatedOrbitObject[] {
  const bands = new Map<string, number>();

  for (const object of objects) {
    const key = `${object.orbitClass}:${Math.round(object.altitudeKm / 100) * 100}`;
    bands.set(key, (bands.get(key) ?? 0) + 1);
  }

  return objects.map((object) => {
    const key = `${object.orbitClass}:${Math.round(object.altitudeKm / 100) * 100}`;
    const crowding = bands.get(key) ?? 0;
    const typeWeight = object.objectType === "debris" ? 0.18 : object.objectType === "rocket_body" ? 0.12 : 0.04;
    const riskScore = clamp01(object.anomalyScore * 0.48 + Math.min(0.34, crowding / 160) + typeWeight);

    return {
      ...object,
      riskScore
    };
  });
}

function vectorLength(vector: Vector3Tuple) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function distanceKm(a: Vector3Tuple, b: Vector3Tuple) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function formatKm(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }

  return `${Math.round(value).toLocaleString()} km`;
}

export function formatDecimal(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }

  return value.toFixed(digits);
}

export function labelForOrbitClass(orbitClass: OrbitClass) {
  return orbitClass === "HEO" ? "Highly Elliptical" : orbitClass;
}
