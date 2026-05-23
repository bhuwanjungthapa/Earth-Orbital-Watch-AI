export type ObjectType = "payload" | "rocket_body" | "debris" | "unknown";

export type OrbitClass = "LEO" | "MEO" | "GEO" | "HEO" | "Deep" | "Unknown";

export type Vector3Tuple = [number, number, number];

export type PredictionMode = "time" | "location";

export interface OrbitObject {
  id: string;
  noradId: string;
  name: string;
  intlDesignator: string | null;
  objectType: ObjectType;
  groups: string[];
  source: string;
  tle1: string;
  tle2: string;
  epoch: string | null;
  meanMotion: number;
  inclination: number;
  eccentricity: number;
  apogeeKm: number | null;
  perigeeKm: number | null;
  periodMinutes: number | null;
  launchYear: number | null;
  bstar: number | null;
  isActive: boolean;
}

export interface CatalogPayload {
  provider: string;
  preset: string;
  groups: string[];
  fetchedAt: string;
  objectCount: number;
  objects: OrbitObject[];
  errors: string[];
}

export interface ClassificationResult {
  orbitClass: OrbitClass;
  confidence: number;
  reasons: string[];
}

export interface AnomalyResult {
  score: number;
  flags: string[];
  reasons: string[];
}

export interface PropagatedOrbitObject extends OrbitObject {
  eciKm: Vector3Tuple;
  scenePosition: Vector3Tuple;
  latitude: number;
  longitude: number;
  altitudeKm: number;
  velocityKms: number;
  orbitClass: OrbitClass;
  classificationConfidence: number;
  classificationReasons: string[];
  anomalyScore: number;
  anomalyFlags: string[];
  anomalyReasons: string[];
  riskScore: number;
  staleDays: number | null;
}

export interface NaturalLanguageIntent {
  objectTypes: ObjectType[];
  orbitClasses: OrbitClass[];
  textTokens: string[];
  beforeYear: number | null;
  afterYear: number | null;
  anomalyOnly: boolean;
  highRiskOnly: boolean;
  activeOnly: boolean | null;
  minAltitudeKm: number | null;
  maxAltitudeKm: number | null;
}

export interface ObjectProfile {
  norad: string;
  fetchedAt: string;
  satcat: Record<string, unknown> | null;
  gp: Record<string, unknown> | null;
  errors: string[];
}

export interface LocationTarget {
  name: string;
  latitude: number;
  longitude: number;
  altitudeKm?: number;
}

export interface PassPrediction {
  status: "visible" | "below_horizon" | "unavailable";
  location: LocationTarget;
  peakTime: string;
  startTime: string | null;
  endTime: string | null;
  peakElevationDeg: number;
  azimuthDeg: number;
  rangeKm: number;
  subpointDistanceKm: number;
  altitudeKm: number;
  summary: string;
}
