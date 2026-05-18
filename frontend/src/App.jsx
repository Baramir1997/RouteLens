import { useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  CircleMarker,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  Activity,
  Brain,
  CheckCircle2,
  Crosshair,
  Loader2,
  MapPin,
  Navigation,
  Play,
  RotateCcw,
  Route,
} from "lucide-react";
import "./App.css";

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function ClickHandler({
  stage,
  setStage,
  setStart,
  setDestination,
  routePoints,
  setCurrentLocation,
  setSnapDistance,
}) {
  useMapEvents({
    async click(e) {
      const point = [e.latlng.lat, e.latlng.lng];

      if (stage === "select_start") {
        setStart(point);
        setStage("ready_destination");
      }

      if (stage === "select_destination") {
        setDestination(point);
        setStage("ready_route");
      }

      if (stage === "select_current") {
        if (routePoints.length === 0) {
          alert("Generate route first.");
          return;
        }

        const response = await fetch("http://127.0.0.1:8000/api/snap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clicked_point: point,
            route_points: routePoints,
          }),
        });

        const data = await response.json();

        setCurrentLocation(data.snapped_point);
        setSnapDistance(data.distance_meters);
        setStage("ready_localization");
      }
    },
  });

  return null;
}

function App() {
  const [stage, setStage] = useState("ready_start");

  const [start, setStart] = useState(null);
  const [destination, setDestination] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [snapDistance, setSnapDistance] = useState(null);

  const [routePoints, setRoutePoints] = useState([]);
  const [sampledPoints, setSampledPoints] = useState([]);
  const [rankedResults, setRankedResults] = useState([]);

  const [currentImages, setCurrentImages] = useState([]);
  const [reasoningPoints, setReasoningPoints] = useState([]);

  const [loading, setLoading] = useState(false);
  const [rankingLoading, setRankingLoading] = useState(false);

  const [reasoningLoading, setReasoningLoading] = useState(false);

  async function generateRoute() {
    if (!start || !destination) {
      alert("Choose start and destination first.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("http://127.0.0.1:8000/api/route", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start,
          destination,
          step_meters: 50,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();

      setRoutePoints(data.route_points);
      setSampledPoints(data.sampled_points);
      setCurrentLocation(null);
      setSnapDistance(null);
      setRankedResults([]);
      setCurrentImages([]);
      setReasoningPoints([]);
      setStage("ready_current");
    } catch (error) {
      console.error(error);
      alert("Route generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runLocalization() {
    if (sampledPoints.length === 0 || !currentLocation) {
      alert("Generate route and choose current location first.");
      return;
    }

    setRankingLoading(true);

    try {
      const response = await fetch("http://127.0.0.1:8000/api/extract-and-rank", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sampled_points: sampledPoints,
          current_location: currentLocation,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      setRankedResults(data.ranked_results);
      setCurrentImages(data.current_images);
      setReasoningPoints([]);
      setStage("ready_reasoning");
    } catch (error) {
      console.error(error);
      alert("Localization failed. Check backend terminal.");
    } finally {
      setRankingLoading(false);
    }
  }

  async function applyReasoning() {
    if (sampledPoints.length === 0 || rankedResults.length === 0 || currentImages.length === 0) {
      alert("Run localization first.");
      return;
    }

    setReasoningLoading(true);

    try {
      const response = await fetch("http://127.0.0.1:8000/api/apply-reasoning", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          route_points: routePoints,
          sampled_points: sampledPoints,
          ranked_results: rankedResults,
          current_images: currentImages,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();

      console.log("Reasoning response:", data);

      setReasoningPoints(data.reasoning_points);
      setRankedResults([]);
      setStage("done");
    } catch (error) {
      console.error(error);
      alert("Reasoning failed. Check backend terminal.");
    } finally {
      setReasoningLoading(false);
    }
  }

  function handleMainButton() {
    if (stage === "ready_start") setStage("select_start");
    else if (stage === "ready_destination") setStage("select_destination");
    else if (stage === "ready_route") generateRoute();
    else if (stage === "ready_current") setStage("select_current");
    else if (stage === "ready_localization") runLocalization();
    else if (stage === "ready_reasoning") applyReasoning();
  }

  function getButtonText() {
    if (loading) return "Generating Route...";
    if (rankingLoading) return "Running Localization...";
    if (reasoningLoading) return "Applying Reasoning...";

    switch (stage) {
      case "ready_start":
        return "Choose Start";
      case "select_start":
        return "Click Start on Map";
      case "ready_destination":
        return "Choose Destination";
      case "select_destination":
        return "Click Destination on Map";
      case "ready_route":
        return "Generate Route";
      case "ready_current":
        return "Choose Current Location";
      case "select_current":
        return "Click Current Location on Map";
      case "ready_localization":
        return "Run Localization";
      case "ready_reasoning":
        return "Apply Reasoning";  
      case "done":
        return "Localization Complete";  
      default:
        return "Continue";
    }
  }

  function isMainButtonDisabled() {
    return (
      loading ||
      rankingLoading ||
      reasoningLoading ||
      stage === "select_start" ||
      stage === "select_destination" ||
      stage === "select_current" ||
      stage === "done"
    );
  }

  function resetAll() {
    setStage("ready_start");
    setStart(null);
    setDestination(null);
    setCurrentLocation(null);
    setSnapDistance(null);
    setRoutePoints([]);
    setSampledPoints([]);
    setRankedResults([]);
    setCurrentImages([]);
    setReasoningPoints([]);
  }

  const busy = loading || rankingLoading || reasoningLoading;
  const currentStepLabel = getButtonText();
  const routeReady = routePoints.length > 0;
  const localizationReady = rankedResults.length > 0;
  const reasoningReady = reasoningPoints.length > 1;
  const topPrediction = rankedResults[0];

  const workflowSteps = [
    {
      label: "Plan route",
      icon: MapPin,
      complete: Boolean(start && destination),
      active: ["ready_start", "select_start", "ready_destination", "select_destination"].includes(stage),
      detail: start && destination ? "Endpoints selected" : "Select start and destination",
    },
    {
      label: "Generate route",
      icon: Route,
      complete: routeReady,
      active: ["ready_route"].includes(stage) || loading,
      detail: routeReady ? `${routePoints.length} route points` : "Build route geometry",
    },
    {
      label: "Choose current location",
      icon: Crosshair,
      complete: Boolean(currentLocation),
      active: ["ready_current", "select_current"].includes(stage),
      detail: currentLocation ? "Snapped to route" : "Pick the observed position",
    },
    {
      label: "Run localization",
      icon: Activity,
      complete: localizationReady || reasoningReady,
      active: ["ready_localization"].includes(stage) || rankingLoading,
      detail: localizationReady ? `${rankedResults.length} ranked candidates` : "Rank visual candidates",
    },
    {
      label: "Apply reasoning",
      icon: Brain,
      complete: stage === "done",
      active: ["ready_reasoning"].includes(stage) || reasoningLoading,
      detail: stage === "done" ? "Reasoned segment ready" : "Refine top matches",
    },
  ];

  const formatPoint = (point) => {
    if (!point) return "Not selected";
    return `${point[0].toFixed(5)}, ${point[1].toFixed(5)}`;
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Geospatial AI route-localization</p>
          <h1>RouteLens</h1>
          <p className="subtitle">
            Visual route matching and multimodal reasoning for known-route localization.
          </p>
        </div>

        <div className="status-strip" aria-label="RouteLens status">
          <span className={`status-pill ${busy ? "is-busy" : "is-ready"}`}>
            {busy ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
            {busy ? "Processing" : "System ready"}
          </span>
          <span className="status-pill">Stage: {stage.replaceAll("_", " ")}</span>
          <span className="status-pill">{sampledPoints.length} samples</span>
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="control-panel glass-panel">
          <div className="panel-section">
            <div className="section-heading">
              <Navigation size={16} />
              <span>Workflow</span>
            </div>

            <div className="workflow-list">
              {workflowSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div
                    className={`workflow-step ${step.active ? "is-active" : ""} ${
                      step.complete ? "is-complete" : ""
                    }`}
                    key={step.label}
                  >
                    <div className="step-index">{step.complete ? <CheckCircle2 size={14} /> : index + 1}</div>
                    <div className="step-copy">
                      <span>
                        <Icon size={14} />
                        {step.label}
                      </span>
                      <small>{step.detail}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel-section action-section">
            <button className="primary-action" onClick={handleMainButton} disabled={isMainButtonDisabled()}>
              {busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {currentStepLabel}
            </button>

            <button className="secondary-action" onClick={resetAll}>
              <RotateCcw size={15} />
              Reset
            </button>
          </div>

          <div className="panel-section">
            <div className="section-heading">
              <Activity size={16} />
              <span>Route stats</span>
            </div>
            <div className="metric-list">
              <div className="metric-row">
                <span>Start</span>
                <strong>{formatPoint(start)}</strong>
              </div>
              <div className="metric-row">
                <span>Destination</span>
                <strong>{formatPoint(destination)}</strong>
              </div>
              <div className="metric-row">
                <span>Current</span>
                <strong>{formatPoint(currentLocation)}</strong>
              </div>
              <div className="metric-row">
                <span>Snap distance</span>
                <strong>{snapDistance !== null ? `${snapDistance.toFixed(1)} m` : "N/A"}</strong>
              </div>
              <div className="metric-row">
                <span>Route points</span>
                <strong>{routePoints.length}</strong>
              </div>
              <div className="metric-row">
                <span>Sampled points</span>
                <strong>{sampledPoints.length}</strong>
              </div>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-heading">
              <Brain size={16} />
              <span>Result status</span>
            </div>
            <div className="result-card">
              <span className={`result-dot ${stage === "done" ? "is-success" : ""}`} />
              <div>
                <strong>{stage === "done" ? "Localization complete" : currentStepLabel}</strong>
                <p>
                  {topPrediction
                    ? `Top candidate #${topPrediction.route_index} with score ${topPrediction.smoothed_similarity.toFixed(4)}`
                    : reasoningReady
                      ? "Reasoned route segment is highlighted on the map."
                      : "Run each workflow step to resolve the current route position."}
                </p>
              </div>
            </div>

            {rankedResults.length > 0 && (
              <div className="prediction-list">
                {rankedResults.slice(0, 5).map((result, index) => (
                  <div className="prediction-row" key={index}>
                    <span>#{index + 1}</span>
                    <strong>Route {result.route_index}</strong>
                    <em>{result.smoothed_similarity.toFixed(4)}</em>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="map-workspace glass-panel">
          <div className="map-header">
            <div>
              <p className="eyebrow">Live map workspace</p>
              <h2>{currentStepLabel}</h2>
            </div>
            <div className="map-legend">
              <span><i className="legend-route" />Route</span>
              <span><i className="legend-sample" />Samples</span>
              <span><i className="legend-match" />Matches</span>
            </div>
          </div>

          <div className="map-frame">
            <MapContainer center={[32.0853, 34.7818]} zoom={14} className="route-map">
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <ClickHandler
                stage={stage}
                setStage={setStage}
                setStart={setStart}
                setDestination={setDestination}
                routePoints={routePoints}
                setCurrentLocation={setCurrentLocation}
                setSnapDistance={setSnapDistance}
              />

              {start && <Marker position={start} icon={markerIcon} />}
              {destination && <Marker position={destination} icon={markerIcon} />}
              {currentLocation && <Marker position={currentLocation} icon={markerIcon} />}

              {routePoints.length > 0 && (
                <Polyline
                  positions={routePoints}
                  weight={5}
                  pathOptions={{ color: "#d7dbe0", opacity: 0.82 }}
                />
              )}

              {reasoningPoints.length > 1 && (
                <Polyline
                  positions={reasoningPoints}
                  pathOptions={{
                    color: "#6fbf9b",
                    weight: 8,
                    opacity: 0.9,
                  }}
                />
              )}

              {reasoningPoints.length === 0 &&
                sampledPoints.map((point, index) => (
                  <CircleMarker
                    key={`sample-${index}`}
                    center={point}
                    radius={4}
                    pathOptions={{
                      color: "#9ca3af",
                      fillColor: "#9ca3af",
                      fillOpacity: 0.25,
                      opacity: 0.75,
                    }}
                  />
                ))}

              {rankedResults.map((result, index) => {
                const isTopPrediction = index === 0;
                const isTopFive = index < 5;

                return (
                  <CircleMarker
                    key={`rank-${index}`}
                    center={result.point}
                    radius={isTopPrediction ? 11 : isTopFive ? 8 : 5}
                    pathOptions={{
                      color: isTopPrediction ? "#88d6c1" : isTopFive ? "#c8b46b" : "#8f98a3",
                      fillColor: isTopPrediction ? "#88d6c1" : isTopFive ? "#c8b46b" : "#8f98a3",
                      fillOpacity: isTopFive ? 0.85 : 0.45,
                      opacity: 0.95,
                    }}
                  >
                    <Tooltip>
                      Rank #{index + 1} | Route index: {result.route_index} | Score:{" "}
                      {result.smoothed_similarity.toFixed(4)}
                    </Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
