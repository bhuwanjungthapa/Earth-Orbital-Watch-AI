import {
  AlertTriangle,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
  EyeOff,
  Filter,
  Info,
  Layers3,
  LocateFixed,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Satellite,
  Search,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { OrbitalScene } from "./components/OrbitalScene";
import { useObjectImage, useObjectProfile, useOrbitCatalog, usePropagatedCatalog } from "./hooks/useOrbitCatalog";
import { buildObjectBrief, getProfileValue, riskLabel } from "./lib/insights";
import { applyNaturalLanguageIntent, parseNaturalLanguageIntent } from "./lib/naturalLanguage";
import { isLocationPassQuery, parseLocationQuery, predictPassForLocation } from "./lib/passPrediction";
import { findNearestObjects, formatDecimal, formatKm, labelForOrbitClass, propagateObject } from "./lib/orbitMath";
import type { EarthMapStyle, ObjectImageResult, ObjectType, OrbitClass, PassPrediction, PredictionMode, PropagatedOrbitObject } from "./types";

const objectOptions: Array<"all" | ObjectType> = ["all", "payload", "debris", "rocket_body", "unknown"];
const orbitOptions: Array<"all" | OrbitClass> = ["all", "LEO", "MEO", "GEO", "HEO", "Deep", "Unknown"];

const objectHelp: Record<"all" | ObjectType, string> = {
  all: "Show every loaded tracked object.",
  payload: "Operational or inactive spacecraft, satellites, stations, and hosted payloads.",
  debris: "Fragments, mission debris, and breakup pieces from tracked TLE groups.",
  rocket_body: "Upper stages, boosters, and spent launch hardware.",
  unknown: "Objects with incomplete or ambiguous classification metadata."
};

const orbitHelp: Record<"all" | OrbitClass, string> = {
  all: "Show every orbit regime.",
  LEO: "Low Earth orbit objects, usually below about 2,000 km.",
  MEO: "Medium Earth orbit objects between LEO and GEO, common for navigation constellations.",
  GEO: "Geosynchronous or geostationary-like objects near the 24-hour orbital period.",
  HEO: "Highly elliptical objects with large altitude swings.",
  Deep: "High-apogee and deep-space catalog objects beyond common GEO bands.",
  Unknown: "Objects whose current TLE data does not clearly fit a known regime."
};

const objectFilterHelp = Object.entries(objectHelp)
  .map(([key, value]) => `${labelOption(key)}: ${value}`)
  .join(" ");
const orbitFilterHelp = Object.entries(orbitHelp)
  .map(([key, value]) => `${labelOption(key)}: ${value}`)
  .join(" ");

export default function App() {
  const [provider] = useState<"celestrak" | "spacetrack">("celestrak");
  const [preset] = useState("wide");
  const [limit] = useState(12000);
  const [query, setQuery] = useState("");
  const [aiCommand, setAiCommand] = useState("");
  const [objectType, setObjectType] = useState<"all" | ObjectType>("all");
  const [orbitClass, setOrbitClass] = useState<"all" | OrbitClass>("all");
  const [anomalyOnly, setAnomalyOnly] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [labelLimit] = useState(5);
  const [isLive, setIsLive] = useState(true);
  const [timeOffsetMinutes, setTimeOffsetMinutes] = useState(0);
  const [predictionMinutes, setPredictionMinutes] = useState(60);
  const [predictionMode, setPredictionMode] = useState<PredictionMode>("time");
  const [predictionQuery, setPredictionQuery] = useState("When will this object pass over Mountain View, California?");
  const [clock, setClock] = useState(() => new Date());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [controlOpen, setControlOpen] = useState(true);
  const [catalogExpanded, setCatalogExpanded] = useState(true);
  const [clearView, setClearView] = useState(false);
  const [mapStyle, setMapStyle] = useState<EarthMapStyle>("realistic");
  const [showClouds, setShowClouds] = useState(true);
  const [showSky, setShowSky] = useState(true);
  const [showGrid, setShowGrid] = useState(false);

  const { catalog, meta, loading, error, refresh } = useOrbitCatalog(provider, preset, limit);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const simDate = useMemo(() => {
    const offset = isLive ? 0 : timeOffsetMinutes;
    return new Date(clock.getTime() + offset * 60_000);
  }, [clock, isLive, timeOffsetMinutes]);

  const propagated = usePropagatedCatalog(catalog, simDate);
  const intent = useMemo(() => parseNaturalLanguageIntent(aiCommand), [aiCommand]);
  const aiAsksLocationPass = useMemo(() => isLocationPassQuery(aiCommand), [aiCommand]);

  const filtered = useMemo(() => {
    const byText = query.trim();
    const baseObjects = byText
      ? propagated.filter((object) => matchesCatalogSearch(object, byText))
      : propagated.filter((object) => {
          if (objectType !== "all" && object.objectType !== objectType) return false;
          if (orbitClass !== "all" && object.orbitClass !== orbitClass) return false;
          if (anomalyOnly && object.anomalyScore < 0.35) return false;
          return true;
        });

    return applyNaturalLanguageIntent(baseObjects, intent);
  }, [propagated, query, objectType, orbitClass, anomalyOnly, intent]);

  const selected = useMemo(
    () => filtered.find((object) => object.noradId === selectedId) ?? propagated.find((object) => object.noradId === selectedId) ?? null,
    [filtered, propagated, selectedId]
  );
  const { profile, loading: profileLoading } = useObjectProfile(selected?.noradId ?? null);
  const { image: objectImage, loading: imageLoading } = useObjectImage(selected);
  const nearest = useMemo(() => findNearestObjects(selected, propagated, 6), [selected, propagated]);
  const passLocation = useMemo(() => parseLocationQuery(predictionQuery), [predictionQuery]);
  const passSearchBucket = Math.floor(simDate.getTime() / 60_000);
  const passSearchDate = useMemo(() => new Date(passSearchBucket * 60_000), [passSearchBucket]);
  const passPrediction = useMemo(() => {
    if (!selected || !passLocation) return null;
    return predictPassForLocation(selected, passSearchDate, passLocation);
  }, [selected?.noradId, selected?.tle1, selected?.tle2, passLocation, passSearchDate]);
  const selectedPrediction = useMemo(() => {
    if (!selected) return null;
    const date =
      predictionMode === "location" && passPrediction
        ? new Date(passPrediction.peakTime)
        : new Date(simDate.getTime() + predictionMinutes * 60_000);
    return propagateObject(selected, date);
  }, [selected, simDate, predictionMinutes, predictionMode, passPrediction]);
  const stats = useMemo(() => createStats(filtered), [filtered]);
  const brief = useMemo(() => buildObjectBrief(selected, profile, nearest), [selected, profile, nearest]);

  useEffect(() => {
    if (aiAsksLocationPass) {
      setPredictionMode("location");
      setPredictionQuery(aiCommand);
    }
  }, [aiCommand, aiAsksLocationPass]);

  const resetCatalog = () => {
    setQuery("");
    setAiCommand("");
    setObjectType("all");
    setOrbitClass("all");
    setAnomalyOnly(false);
    setShowLabels(false);
    setSelectedId(null);
    setHoveredId(null);
    setCatalogExpanded(true);
  };

  return (
    <main className={`app-shell ${clearView ? "is-clear-view" : ""}`}>
      <div className="scene-layer">
        <OrbitalScene
          objects={filtered}
          selected={selected}
          hoveredId={hoveredId}
          showLabels={showLabels}
          labelLimit={labelLimit}
          date={simDate}
          prediction={selectedPrediction}
          predictionMode={predictionMode}
          passLocation={predictionMode === "location" ? passLocation : null}
          mapStyle={mapStyle}
          showClouds={showClouds}
          showSky={showSky}
          showGrid={showGrid}
          onHover={setHoveredId}
          onSelect={(object) => setSelectedId(object.noradId)}
        />
      </div>

      <section className={`top-bar ${clearView ? "is-hidden" : ""}`}>
        <div>
          <p className="eyebrow">Serverless orbital intelligence</p>
          <h1>Earth Orbital Watch AI</h1>
        </div>
        <div className="status-row">
          <span className={`live-dot ${loading ? "is-loading" : ""}`} />
          <span>{loading ? "Syncing" : "Live propagated"}</span>
          <span>{meta.provider}</span>
          <button className="icon-button" type="button" onClick={refresh} aria-label="Refresh catalog">
            <RefreshCw size={17} />
          </button>
        </div>
      </section>

      <div className="view-toolbar">
        {!clearView ? (
          <button className="control-button" type="button" onClick={() => setControlOpen((value) => !value)}>
            {controlOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            Catalog
          </button>
        ) : null}
        <button className={`control-button ${clearView ? "is-active" : ""}`} type="button" onClick={() => setClearView((value) => !value)}>
          {clearView ? <Eye size={16} /> : <EyeOff size={16} />}
          {clearView ? "Show UI" : "Clear view"}
        </button>
      </div>

      {controlOpen && !clearView ? (
        <aside className={`control-panel ${catalogExpanded ? "" : "is-collapsed"}`}>
          <div className="panel-heading">
            <PanelTitle
              icon={<Satellite size={18} />}
              title="Catalog"
              help="Catalog controls decide which tracked objects are rendered in the 3D scene. The raw catalog stays loaded while filters change only the visible layer."
            />
            <div className="panel-actions">
              <button
                className="icon-button"
                type="button"
                onClick={() => setCatalogExpanded((value) => !value)}
                aria-label={catalogExpanded ? "Collapse catalog" : "Expand catalog"}
                title={catalogExpanded ? "Collapse catalog" : "Expand catalog"}
              >
                {catalogExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              <button className="icon-button" type="button" onClick={() => setControlOpen(false)} aria-label="Close catalog panel">
                <X size={18} />
              </button>
            </div>
          </div>
          {catalogExpanded ? (
            <div className="catalog-body">
              <div className="metric-strip">
                <Metric label="Visible" value={filtered.length.toLocaleString()} help="Objects currently passing the search, AI command, type, orbit, and watch filters." />
                <Metric label="Loaded" value={meta.objectCount.toLocaleString()} help="Total objects returned by the serverless catalog endpoint before UI filtering." />
                <Metric label="Watch" value={stats.watch.toLocaleString()} help="Visible objects with elevated anomaly or crowding risk scores." />
              </div>

              <label className="field">
                <FieldLabel icon={<Search size={15} />} label="Search" help="Search scans the whole loaded catalog by name, NORAD ID, international designator, source groups, object type, and orbit class." />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="NORAD, ISS, STARLINK, COSMOS" />
              </label>

              <label className="field ai-field">
                <FieldLabel
                  icon={<BrainCircuit size={15} />}
                  label="AI Command"
                  help="Natural language filter. Try requests like GEO satellites, UK satellites, high risk debris below 600 km, or a selected-object pass query."
                />
                <input
                  value={aiCommand}
                  onChange={(event) => setAiCommand(event.target.value)}
                  placeholder="Try: show GEO satellites, UK satellites, high risk debris, or pass over San Jose"
                />
              </label>
              {aiAsksLocationPass && !selected ? (
                <div className="notice subtle">Location detected. Select an object in the scene to show this pass prediction.</div>
              ) : null}

              <PanelTitle
                icon={<Filter size={18} />}
                title="Filters"
                compact
                help="Filters combine together. For example, Object debris plus Orbit LEO shows only debris currently classified in low Earth orbit."
              />
              <div className="grid-two">
                <label className="field">
                  <FieldLabel label="Object" help={objectFilterHelp} />
                  <select value={objectType} onChange={(event) => setObjectType(event.target.value as "all" | ObjectType)} aria-label="Object type filter">
                    {objectOptions.map((option) => (
                      <option key={option} value={option} title={objectHelp[option]}>{labelOption(option)}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <FieldLabel label="Orbit" help={orbitFilterHelp} />
                  <select value={orbitClass} onChange={(event) => setOrbitClass(event.target.value as "all" | OrbitClass)} aria-label="Orbit class filter">
                    {orbitOptions.map((option) => (
                      <option key={option} value={option} title={orbitHelp[option]}>{labelOption(option)}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="toggle-row">
                <CatalogToggle
                  active={anomalyOnly}
                  icon={<AlertTriangle size={16} />}
                  label="Watch only"
                  help="Limits the scene to objects with stronger decay, drag, crowding, debris, or risk indicators."
                  onClick={() => setAnomalyOnly((value) => !value)}
                />
                <CatalogToggle
                  active={showLabels}
                  icon={<LocateFixed size={16} />}
                  label="Labels"
                  help="Shows a small label set for the selected object, hovered object, and highest-priority visible objects."
                  onClick={() => setShowLabels((value) => !value)}
                />
              </div>

              <PanelTitle
                icon={<Layers3 size={18} />}
                title="Earth Map"
                compact
                help="Scene display controls. Terrain and default map styles add country boundaries without requiring paid map keys."
              />
              <label className="field">
                <FieldLabel label="Map style" help="4K imagery uses the current Earth texture. Terrain adds shaded relief and country outlines. Default is a cleaner atlas-style render with country outlines." />
                <select value={mapStyle} onChange={(event) => setMapStyle(event.target.value as EarthMapStyle)} aria-label="Earth map style">
                  <option value="realistic">Current 4K</option>
                  <option value="terrain">Terrain</option>
                  <option value="default">Default map</option>
                </select>
              </label>

              <div className="toggle-row">
                <CatalogToggle
                  active={showClouds}
                  icon={<Layers3 size={16} />}
                  label="Clouds"
                  help="Toggle the cloud texture layer over Earth."
                  onClick={() => setShowClouds((value) => !value)}
                />
                <CatalogToggle
                  active={showSky}
                  icon={<Sparkles size={16} />}
                  label="Sky"
                  help="Toggle the galaxy star background."
                  onClick={() => setShowSky((value) => !value)}
                />
                <CatalogToggle
                  active={showGrid}
                  icon={<LocateFixed size={16} />}
                  label="Lat/Lon"
                  help="Toggle dense 15-degree latitude and longitude reference lines on Earth."
                  onClick={() => setShowGrid((value) => !value)}
                />
              </div>

              <div className="catalog-actions">
                <button className="control-button reset-button" type="button" onClick={resetCatalog}>
                  <RotateCcw size={16} /> Reset catalog
                </button>
                <InfoTooltip text="Clears search, AI command, object filter, orbit filter, watch mode, labels, and the selected object." />
              </div>

              {error ? <div className="notice">{error}</div> : null}
            </div>
          ) : (
            <div className="catalog-summary">
              <strong>{filtered.length.toLocaleString()}</strong>
              <span>visible of {meta.objectCount.toLocaleString()} loaded</span>
            </div>
          )}
        </aside>
      ) : null}

      {!clearView && selected ? (
        <aside className={`detail-panel ${selected ? "is-open" : ""}`}>
          <>
            <div className="detail-heading">
              <div>
                <p className="eyebrow">{selected.objectType.replace("_", " ")} · NORAD {selected.noradId}</p>
                <h2>{selected.name}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setSelectedId(null)} aria-label="Close object details">
                <X size={18} />
              </button>
            </div>

            <div className="badge-row">
              <span>{labelForOrbitClass(selected.orbitClass)}</span>
              <span>{riskLabel(selected.riskScore)} risk</span>
              <span>{profileLoading ? "Loading SATCAT" : profile ? "SATCAT linked" : "TLE only"}</span>
            </div>

            <section className="brief-panel">
              <div><Sparkles size={17} /> AI Brief</div>
              <p>{brief}</p>
            </section>

            <section className="object-image-panel">
              <h3>Reference Image</h3>
              {imageLoading ? (
                <div className="image-placeholder">Searching public image sources</div>
              ) : objectImage?.imageUrl ? (
                <a href={objectImage.pageUrl ?? objectImage.imageUrl} target="_blank" rel="noreferrer">
                  <img src={objectImage.imageUrl} alt={objectImage.title ?? selected.name} />
                  <span>{objectImage.title ?? selected.name} · {sourceLabel(objectImage.source)}</span>
                </a>
              ) : (
                <div className="image-placeholder">
                  <span>No public image source found</span>
                  <a href={googleImageSearchUrl(selected)} target="_blank" rel="noreferrer">Search Google Images</a>
                </div>
              )}
            </section>

            <div className="metric-grid">
              <Metric label="Altitude" value={formatKm(selected.altitudeKm)} />
              <Metric label="Velocity" value={`${formatDecimal(selected.velocityKms, 2)} km/s`} />
              <Metric label="Inclination" value={`${formatDecimal(selected.inclination, 2)}°`} />
              <Metric label="Eccentricity" value={formatDecimal(selected.eccentricity, 4)} />
              <Metric label="Perigee" value={formatKm(selected.perigeeKm)} />
              <Metric label="Apogee" value={formatKm(selected.apogeeKm)} />
              <Metric label="Latitude" value={`${formatDecimal(selected.latitude, 2)}°`} />
              <Metric label="Longitude" value={`${formatDecimal(selected.longitude, 2)}°`} />
            </div>

            <PredictionPanel
              mode={predictionMode}
              onModeChange={setPredictionMode}
              query={predictionQuery}
              onQueryChange={setPredictionQuery}
              timeMinutes={predictionMinutes}
              timePrediction={selectedPrediction}
              passPrediction={passPrediction}
            />

            <section className="explain-panel">
              <h3>Model Explainability</h3>
              <ul>
                {selected.classificationReasons.map((reason) => <li key={reason}>{reason}</li>)}
                {selected.anomalyReasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </section>

            <section className="nearest-panel">
              <h3>Nearest Rendered Objects</h3>
              <div className="nearest-list">
                {nearest.map(({ object, distanceKm }) => (
                  <button key={object.noradId} type="button" onClick={() => setSelectedId(object.noradId)}>
                    <span>{object.name}</span>
                    <strong>{Math.round(distanceKm).toLocaleString()} km</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="profile-panel">
              <h3>Catalog Profile</h3>
              <div className="profile-grid">
                <Metric label="Owner" value={getProfileValue(profile, "OWNER") ?? "Unknown"} />
                <Metric label="Launch" value={getProfileValue(profile, "LAUNCH_DATE") ?? selected.launchYear?.toString() ?? "Unknown"} />
                <Metric label="Site" value={getProfileValue(profile, "LAUNCH_SITE") ?? "Unknown"} />
                <Metric label="RCS" value={getProfileValue(profile, "RCS") ?? "Unknown"} />
              </div>
            </section>
          </>
        </aside>
      ) : null}

      <section className={`time-panel ${clearView ? "is-compact" : ""}`}>
        <button className="control-button" type="button" onClick={() => setIsLive((value) => !value)}>
          {isLive ? <Pause size={16} /> : <Play size={16} />}
          {isLive ? "Pause" : "Live"}
        </button>
        <button
          className="control-button"
          type="button"
          onClick={() => {
            setIsLive(true);
            setTimeOffsetMinutes(0);
          }}
        >
          <RotateCcw size={16} /> Now
        </button>
        <label className="timeline">
          <span><Clock3 size={15} /> {simDate.toLocaleString()}</span>
          <input
            type="range"
            min="-1440"
            max="1440"
            step="10"
            value={timeOffsetMinutes}
            disabled={isLive}
            onChange={(event) => {
              setIsLive(false);
              setTimeOffsetMinutes(Number(event.target.value));
            }}
          />
        </label>
        <label className="prediction-select">
          <span>Time target</span>
          <select
            value={predictionMinutes}
            disabled={predictionMode === "location"}
            onChange={(event) => setPredictionMinutes(Number(event.target.value))}
          >
            <option value={10}>+10m</option>
            <option value={60}>+1h</option>
            <option value={360}>+6h</option>
            <option value={1440}>+24h</option>
          </select>
        </label>
      </section>
    </main>
  );
}

function PredictionPanel({
  mode,
  onModeChange,
  query,
  onQueryChange,
  timeMinutes,
  timePrediction,
  passPrediction
}: {
  mode: PredictionMode;
  onModeChange: (mode: PredictionMode) => void;
  query: string;
  onQueryChange: (query: string) => void;
  timeMinutes: number;
  timePrediction: PropagatedOrbitObject | null;
  passPrediction: PassPrediction | null;
}) {
  return (
    <section className="prediction-panel">
      <div className="prediction-heading">
        <h3>Prediction</h3>
        <div className="segmented-control">
          <button className={mode === "time" ? "is-active" : ""} type="button" onClick={() => onModeChange("time")}>
            Time
          </button>
          <button className={mode === "location" ? "is-active" : ""} type="button" onClick={() => onModeChange("location")}>
            Location
          </button>
        </div>
      </div>

      {mode === "time" ? (
        <div className="prediction-body">
          <p>
            Projected position at +{timeMinutes < 60 ? `${timeMinutes} minutes` : `${timeMinutes / 60} hours`}.
          </p>
          {timePrediction ? (
            <div className="profile-grid">
              <Metric label="Altitude" value={formatKm(timePrediction.altitudeKm)} />
              <Metric label="Latitude" value={`${formatDecimal(timePrediction.latitude, 2)}°`} />
              <Metric label="Longitude" value={`${formatDecimal(timePrediction.longitude, 2)}°`} />
              <Metric label="Velocity" value={`${formatDecimal(timePrediction.velocityKms, 2)} km/s`} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="prediction-body">
          <label className="field location-query">
            <span><MapPin size={15} /> Pass location</span>
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} />
          </label>
          {passPrediction ? (
            <>
              <p>{passPrediction.summary}</p>
              <div className="profile-grid">
                <Metric label="Peak" value={formatDateTime(passPrediction.peakTime)} />
                <Metric label="Elevation" value={`${formatDecimal(passPrediction.peakElevationDeg, 1)}°`} />
                <Metric label="Range" value={formatKm(passPrediction.rangeKm)} />
                <Metric label="Ground miss" value={formatKm(passPrediction.subpointDistanceKm)} />
              </div>
            </>
          ) : (
            <p>Try a known place such as Mountain View, California, or enter coordinates like 37.3861, -122.0839.</p>
          )}
        </div>
      )}
    </section>
  );
}

function PanelTitle({
  icon,
  title,
  compact = false,
  help
}: {
  icon: ReactNode;
  title: string;
  compact?: boolean;
  help?: string;
}) {
  return (
    <div className={`panel-title ${compact ? "is-compact" : ""}`}>
      {icon}
      <h2>{title}</h2>
      {help ? <InfoTooltip text={help} /> : null}
    </div>
  );
}

function FieldLabel({ icon, label, help }: { icon?: ReactNode; label: string; help: string }) {
  return (
    <span className="field-label">
      {icon}
      {label}
      <InfoTooltip text={help} />
    </span>
  );
}

function CatalogToggle({
  active,
  icon,
  label,
  help,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  help: string;
  onClick: () => void;
}) {
  return (
    <div className="toggle-item">
      <button className={`toggle-button ${active ? "is-active" : ""}`} type="button" onClick={onClick} title={help}>
        {icon} {label}
      </button>
      <InfoTooltip text={help} />
    </div>
  );
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="info-tip" tabIndex={0} aria-label={text} title={text}>
      <Info size={14} />
      <span className="tooltip-card" role="tooltip">{text}</span>
    </span>
  );
}

function Metric({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="metric">
      <span className="metric-label">
        {label}
        {help ? <InfoTooltip text={help} /> : null}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function createStats(objects: PropagatedOrbitObject[]) {
  const orbitMap = new Map<OrbitClass, number>();
  let watch = 0;

  for (const object of objects) {
    orbitMap.set(object.orbitClass, (orbitMap.get(object.orbitClass) ?? 0) + 1);
    if (object.anomalyScore >= 0.35 || object.riskScore >= 0.42) watch += 1;
  }

  return {
    watch,
    orbits: Array.from(orbitMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  };
}

function labelOption(option: string) {
  return option === "all" ? "All" : option.replace("_", " ");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function matchesCatalogSearch(object: PropagatedOrbitObject, query: string) {
  const normalizedQuery = normalizeCatalogText(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeCatalogText([
    object.name,
    object.noradId,
    object.intlDesignator ?? "",
    object.groups.join(" "),
    object.source,
    object.objectType,
    object.orbitClass
  ].join(" "));
  const terms = expandedSearchTerms(normalizedQuery);

  return terms.every((term) => haystack.includes(term));
}

function expandedSearchTerms(query: string) {
  const aliases: Record<string, string[]> = {
    hubble: ["hubble"],
    hst: ["hubble"],
    iss: ["iss"],
    geo: ["geo"],
    geostationary: ["geo"],
    geosynchronous: ["geo"],
    uk: ["uk"],
    british: ["uk"],
    "united kingdom": ["uk"],
    gps: ["gps"],
    navstar: ["gps"],
    cosmos: ["cosmos"],
    kosmos: ["cosmos"]
  };

  return query
    .split(" ")
    .filter(Boolean)
    .flatMap((term) => aliases[term] ?? [term]);
}

function normalizeCatalogText(value: string) {
  return value
    .toLowerCase()
    .replace(/\bu\.k\.\b/g, "uk")
    .replace(/\bu\.s\.\b/g, "usa")
    .replace(/\bunited kingdom\b/g, "uk")
    .replace(/\bgeostationary\b/g, "geo")
    .replace(/\bgeosynchronous\b/g, "geo")
    .replace(/\bkosmos\b/g, "cosmos")
    .replace(/r\/b/g, "rocket body")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceLabel(source: ObjectImageResult["source"]) {
  const labels: Record<ObjectImageResult["source"], string> = {
    wikipedia: "Wikipedia",
    wikimedia: "Wikimedia Commons",
    wikidata: "Wikidata",
    google: "Google Images",
    nasa: "NASA Images",
    none: "Public source"
  };

  return labels[source];
}

function googleImageSearchUrl(object: PropagatedOrbitObject) {
  const type = object.objectType === "rocket_body" ? "rocket body" : object.objectType === "debris" ? "space debris" : "satellite";
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${object.name} ${type}`)}`;
}
