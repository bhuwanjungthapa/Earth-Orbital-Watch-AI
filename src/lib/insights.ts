import type { ObjectProfile, PropagatedOrbitObject } from "../types";
import { formatDecimal, formatKm, labelForOrbitClass } from "./orbitMath";

export function buildObjectBrief(
  object: PropagatedOrbitObject | null,
  profile: ObjectProfile | null,
  nearest: Array<{ object: PropagatedOrbitObject; distanceKm: number }>
) {
  if (!object) {
    return "Select an object to generate an orbital intelligence brief.";
  }

  const owner = getProfileValue(profile, "OWNER");
  const launchDate = getProfileValue(profile, "LAUNCH_DATE");
  const primary = `${object.name} is a ${object.objectType.replace("_", " ")} in ${labelForOrbitClass(object.orbitClass)} with a current propagated altitude of ${formatKm(object.altitudeKm)}.`;
  const orbit = `The model classifies it with ${(object.classificationConfidence * 100).toFixed(0)}% confidence from period, altitude, and eccentricity features.`;
  const watch = object.anomalyScore >= 0.45
    ? `It is flagged for ${object.anomalyFlags.join(", ")} with a watch score of ${(object.anomalyScore * 100).toFixed(0)}.`
    : `Its anomaly score is ${(object.anomalyScore * 100).toFixed(0)}, with no strong watch condition from the current features.`;
  const proximity = nearest[0]
    ? `The nearest rendered neighbor is ${nearest[0].object.name} at about ${Math.round(nearest[0].distanceKm).toLocaleString()} km in ECI space.`
    : "Nearest-neighbor analysis is waiting for more propagated objects.";
  const identity = owner || launchDate
    ? `SATCAT metadata lists ${[owner ? `owner ${owner}` : "", launchDate ? `launch date ${launchDate}` : ""].filter(Boolean).join(" and ")}.`
    : "";

  return [primary, orbit, watch, proximity, identity].filter(Boolean).join(" ");
}

export function getProfileValue(profile: ObjectProfile | null, key: string) {
  const value = profile?.satcat?.[key];

  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

export function riskLabel(value: number) {
  if (value >= 0.66) return "High";
  if (value >= 0.38) return "Watch";
  return "Low";
}

export function formatMaybeNumber(value: unknown, suffix = "") {
  if (typeof value === "number") {
    return `${formatDecimal(value, 2)}${suffix}`;
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return "Unknown";
}
