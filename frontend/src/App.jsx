import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  CircleMarker,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import {
  Camera,
  CheckCircle2,
  Crosshair,
  Database,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Play,
  RefreshCcw,
  Route,
  Upload,
  Wifi,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const API_BASE = "http://127.0.0.1:8000";

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function filePathToUrl(path) {
  if (!path) return "";

  const normalized = path.replaceAll("\\", "/");
  const streetviewIndex = normalized.indexOf("streetview_images/");
  const cacheIndex = normalized.indexOf("offline_route_caches/");
  const uploadIndex = normalized.indexOf("offline_uploads/");

  if (streetviewIndex >= 0) {
    return `${API_BASE}/files/streetview/${normalized.slice(streetviewIndex + "streetview_images/".length)}`;
  }

  if (cacheIndex >= 0) {
    return `${API_BASE}/files/offline-caches/${normalized.slice(cacheIndex + "offline_route_caches/".length)}`;
  }

  if (uploadIndex >= 0) {
    return `${API_BASE}/files/offline-uploads/${normalized.slice(uploadIndex + "offline_uploads/".length)}`;
  }

  return "";
}

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

        const response = await fetch(`${API_BASE}/api/snap`, {
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

function StatusPill({ tone = "neutral", children }) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}

function StepItem({ icon: Icon, title, detail, state }) {
  return (
    <div className={`step-item step-${state}`}>
      <div className="step-icon">
        <Icon size={17} />
      </div>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
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
  const [offlineCaches, setOfflineCaches] = useState([]);
  const [selectedCacheId, setSelectedCacheId] = useState("");
  const [offlineImage, setOfflineImage] = useState(null);
  const [offlinePreviewUrl, setOfflinePreviewUrl] = useState("");
  const [offlineConfidence, setOfflineConfidence] = useState(null);
  const [queryImagePath, setQueryImagePath] = useState("");

  const [loading, setLoading] = useState(false);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [reasoningLoading, setReasoningLoading] = useState(false);

  const selectedCache = offlineCaches.find((cache) => cache.cache_id === selectedCacheId);
  const bestMatch = rankedResults[0];
  const bestMatchImage = bestMatch?.best_route_image_path
    ? filePathToUrl(bestMatch.best_route_image_path)
    : "";
  const uploadedImageUrl = queryImagePath
    ? filePathToUrl(queryImagePath)
    : offlinePreviewUrl;

  const isBusy = loading || rankingLoading || cacheLoading || offlineLoading || reasoningLoading;

  const workflowSteps = useMemo(() => [
    {
      icon: Route,
      title: "Plan route",
      detail: routePoints.length ? `${routePoints.length} route points` : "Choose start and destination",
      state: routePoints.length ? "complete" : stage.includes("start") || stage.includes("destination") || stage === "ready_route" ? "active" : "idle",
    },
    {
      icon: Database,
      title: "Prepare cache",
      detail: selectedCache ? `${selectedCache.num_route_images} cached views` : "Street View images and CLIP embeddings",
      state: selectedCache ? "complete" : sampledPoints.length ? "active" : "idle",
    },
    {
      icon: Upload,
      title: "Upload photo",
      detail: offlineImage ? offlineImage.name : "Use a real image from the route",
      state: offlineImage ? "complete" : selectedCache ? "active" : "idle",
    },
    {
      icon: Crosshair,
      title: "Match location",
      detail: offlineConfidence !== null ? `${Math.round(offlineConfidence * 100)}% confidence` : "Estimate position visually",
      state: offlineConfidence !== null ? "complete" : offlineImage ? "active" : "idle",
    },
  ], [offlineConfidence, offlineImage, routePoints.length, sampledPoints.length, selectedCache, stage]);

  useEffect(() => {
    loadOfflineCaches();
  }, []);

  useEffect(() => {
    if (!offlineImage) {
      setOfflinePreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(offlineImage);
    setOfflinePreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [offlineImage]);

  async function loadOfflineCaches() {
    try {
      const response = await fetch(`${API_BASE}/api/offline/caches`);

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      setOfflineCaches(data.caches);

      if (!selectedCacheId && data.caches.length > 0) {
        setSelectedCacheId(data.caches[0].cache_id);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function generateRoute() {
    if (!start || !destination) {
      alert("Choose start and destination first.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/route`, {
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
      setOfflineConfidence(null);
      setQueryImagePath("");
      setStage("ready_current");
    } catch (error) {
      console.error(error);
      alert("Route generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function prepareOfflineCache() {
    if (sampledPoints.length === 0) {
      alert("Generate a route first.");
      return;
    }

    setCacheLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/offline/prepare-cache`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sampled_points: sampledPoints,
          cache_name: `Route cache ${new Date().toLocaleString()}`,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      setSelectedCacheId(data.cache_id);
      await loadOfflineCaches();
    } catch (error) {
      console.error(error);
      alert("Offline cache failed. Check backend terminal.");
    } finally {
      setCacheLoading(false);
    }
  }

  async function runOfflineLocalization() {
    if (!selectedCacheId || !offlineImage) {
      alert("Choose an offline cache and upload a photo first.");
      return;
    }

    setOfflineLoading(true);

    try {
      const formData = new FormData();
      formData.append("cache_id", selectedCacheId);
      formData.append("image", offlineImage);

      const response = await fetch(`${API_BASE}/api/offline/localize`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      setRankedResults(data.ranked_results);
      setCurrentImages([]);
      setReasoningPoints([]);
      setOfflineConfidence(data.confidence);
      setQueryImagePath(data.query_image_path);
      setStage("done");
    } catch (error) {
      console.error(error);
      alert("Offline localization failed. Check backend terminal.");
    } finally {
      setOfflineLoading(false);
    }
  }

  async function runLocalization() {
    if (sampledPoints.length === 0 || !currentLocation) {
      alert("Generate route and choose current location first.");
      return;
    }

    setRankingLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/extract-and-rank`, {
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
      setOfflineConfidence(null);
      setQueryImagePath("");
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
      const response = await fetch(`${API_BASE}/api/apply-reasoning`, {
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
    if (loading) return "Generating route";
    if (rankingLoading) return "Running online localization";
    if (reasoningLoading) return "Applying Gemini reasoning";

    switch (stage) {
      case "ready_start":
        return "Choose start";
      case "select_start":
        return "Click start on map";
      case "ready_destination":
        return "Choose destination";
      case "select_destination":
        return "Click destination on map";
      case "ready_route":
        return "Generate route";
      case "ready_current":
        return "Choose current location";
      case "select_current":
        return "Click current location";
      case "ready_localization":
        return "Run online localization";
      case "ready_reasoning":
        return "Apply reasoning";
      case "done":
        return "Localization complete";
      default:
        return "Continue";
    }
  }

  function isMainButtonDisabled() {
    return (
      isBusy ||
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
    setOfflineConfidence(null);
    setQueryImagePath("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
          </div>
          <div>
            <strong>RouteLens</strong>
            <span>Offline visual route localization</span>
          </div>
        </div>

        <div className="topbar-status">
          <StatusPill tone="success"><Wifi size={14} /> Backend ready</StatusPill>
          <StatusPill tone={selectedCache ? "success" : "neutral"}>
            <Database size={14} /> {selectedCache ? "Cache selected" : "No cache"}
          </StatusPill>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-panel">
          <section className="panel-section intro-section">
            <h1>Find position from a photo</h1>
            <p>
              Prepare a visual route once, upload a route photo, and estimate location
              from saved CLIP embeddings.
            </p>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <span>Workflow</span>
              {isBusy && <Loader2 size={16} className="spin" />}
            </div>
            <div className="step-list">
              {workflowSteps.map((step) => (
                <StepItem key={step.title} {...step} />
              ))}
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <span>Route setup</span>
              <Route size={16} />
            </div>
            <div className="button-grid">
              <button className="primary-action" onClick={handleMainButton} disabled={isMainButtonDisabled()}>
                {isBusy ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                {getButtonText()}
              </button>
              <button className="secondary-action" onClick={resetAll} disabled={isBusy}>
                <RefreshCcw size={16} />
                Reset
              </button>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <span>Offline mode</span>
              <Database size={16} />
            </div>

            <button
              className="secondary-action full-width"
              onClick={prepareOfflineCache}
              disabled={cacheLoading || sampledPoints.length === 0}
            >
              {cacheLoading ? <Loader2 size={16} className="spin" /> : <Database size={16} />}
              {cacheLoading ? "Preparing cache" : "Prepare offline cache"}
            </button>

            <label className="field-label">
              Route cache
              <select
                value={selectedCacheId}
                onChange={(event) => setSelectedCacheId(event.target.value)}
              >
                <option value="">No offline cache selected</option>
                {offlineCaches.map((cache) => (
                  <option key={cache.cache_id} value={cache.cache_id}>
                    {cache.cache_name} ({cache.num_route_images} images)
                  </option>
                ))}
              </select>
            </label>

            <label className="upload-zone">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  setOfflineImage(event.target.files?.[0] || null);
                  setQueryImagePath("");
                }}
              />
              <Upload size={18} />
              <span>{offlineImage ? offlineImage.name : "Upload route photo"}</span>
            </label>

            <button
              className="primary-action full-width"
              onClick={runOfflineLocalization}
              disabled={offlineLoading || !selectedCacheId || !offlineImage}
            >
              {offlineLoading ? <Loader2 size={16} className="spin" /> : <Crosshair size={16} />}
              {offlineLoading ? "Matching photo" : "Offline match photo"}
            </button>
          </section>

          <section className="panel-section result-summary">
            <div className="section-title">
              <span>Result</span>
              <CheckCircle2 size={16} />
            </div>
            <div className="metric-row">
              <span>Confidence</span>
              <strong>{offlineConfidence !== null ? `${Math.round(offlineConfidence * 100)}%` : "N/A"}</strong>
            </div>
            <div className="metric-row">
              <span>Top route index</span>
              <strong>{bestMatch ? `#${bestMatch.route_index}` : "N/A"}</strong>
            </div>
            <div className="metric-row">
              <span>Sampled points</span>
              <strong>{sampledPoints.length}</strong>
            </div>
          </section>
        </aside>

        <section className="map-workspace">
          <div className="map-header">
            <div>
              <h2>Route map</h2>
              <p>{getButtonText()}</p>
            </div>
            <div className="map-stats">
              <StatusPill>{routePoints.length} route points</StatusPill>
              <StatusPill>{sampledPoints.length} samples</StatusPill>
            </div>
          </div>

          <div className="map-frame">
            <MapContainer
              center={[40.758, -73.9855]}
              zoom={14}
              className="route-map"
            >
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
                  pathOptions={{ color: "#d7dce5", weight: 5, opacity: 0.82 }}
                />
              )}

              {reasoningPoints.length > 1 && (
                <Polyline
                  positions={reasoningPoints}
                  pathOptions={{
                    color: "#f59e0b",
                    weight: 8,
                    opacity: 0.95,
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
                      color: "#64748b",
                      fillColor: "#94a3b8",
                      fillOpacity: 0.35,
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
                    radius={isTopPrediction ? 12 : isTopFive ? 8 : 5}
                    pathOptions={{
                      color: isTopPrediction ? "#f8fafc" : isTopFive ? "#8fd6aa" : "#64748b",
                      fillColor: isTopPrediction ? "#f8fafc" : isTopFive ? "#8fd6aa" : "#64748b",
                      fillOpacity: isTopFive ? 0.9 : 0.45,
                      weight: isTopPrediction ? 4 : 2,
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

          <div className="insight-grid">
            <article className="insight-panel image-compare">
              <div className="section-title">
                <span>Photo evidence</span>
                <Camera size={16} />
              </div>
              <div className="image-pair">
                <div className="preview-tile">
                  {uploadedImageUrl ? (
                    <img src={uploadedImageUrl} alt="Uploaded route" />
                  ) : (
                    <div className="empty-preview">
                      <ImageIcon size={24} />
                      <span>Uploaded photo</span>
                    </div>
                  )}
                  <strong>User photo</strong>
                </div>

                <div className="preview-tile">
                  {bestMatchImage ? (
                    <img src={bestMatchImage} alt="Best visual match" />
                  ) : (
                    <div className="empty-preview">
                      <MapPin size={24} />
                      <span>Best route view</span>
                    </div>
                  )}
                  <strong>Best match</strong>
                </div>
              </div>
            </article>

            <article className="insight-panel">
              <div className="section-title">
                <span>Top visual matches</span>
                <Crosshair size={16} />
              </div>
              <div className="match-list">
                {rankedResults.length === 0 ? (
                  <p className="empty-copy">Upload a photo and run offline matching to see candidates.</p>
                ) : (
                  rankedResults.slice(0, 5).map((result, index) => (
                    <div className="match-row" key={`${result.route_index}-${index}`}>
                      <span className="rank-badge">#{index + 1}</span>
                      <div>
                        <strong>Route index {result.route_index}</strong>
                        <span>Score {result.smoothed_similarity.toFixed(4)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>
          </div>

          <div className="detail-strip">
            <span>Start: {start ? start.map((value) => value.toFixed(5)).join(", ") : "not selected"}</span>
            <span>Destination: {destination ? destination.map((value) => value.toFixed(5)).join(", ") : "not selected"}</span>
            <span>Current: {currentLocation ? currentLocation.map((value) => value.toFixed(5)).join(", ") : "not selected"}</span>
            <span>Snap: {snapDistance !== null ? `${snapDistance.toFixed(1)}m` : "N/A"}</span>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
