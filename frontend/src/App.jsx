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

  const [loading, setLoading] = useState(false);
  const [rankingLoading, setRankingLoading] = useState(false);

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
      setStage("done");
    } catch (error) {
      console.error(error);
      alert("Localization failed. Check backend terminal.");
    } finally {
      setRankingLoading(false);
    }
  }

  function handleMainButton() {
    if (stage === "ready_start") setStage("select_start");
    else if (stage === "ready_destination") setStage("select_destination");
    else if (stage === "ready_route") generateRoute();
    else if (stage === "ready_current") setStage("select_current");
    else if (stage === "ready_localization") runLocalization();
  }

  function getButtonText() {
    if (loading) return "Generating Route...";
    if (rankingLoading) return "Running Localization...";

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
  }

  return (
    <div style={{ padding: "20px", fontFamily: "Arial" }}>
      <h1>Visual Route Localization</h1>

      <div style={{ marginBottom: "12px", display: "flex", gap: "8px" }}>
        <button
          onClick={handleMainButton}
          disabled={isMainButtonDisabled()}
          style={{
            padding: "10px 16px",
            fontWeight: "bold",
            cursor: isMainButtonDisabled() ? "not-allowed" : "pointer",
          }}
        >
          {getButtonText()}
        </button>

        <button onClick={resetAll} style={{ padding: "10px 16px" }}>
          Reset
        </button>
      </div>

      <p>
        Current step: <b>{getButtonText()}</b>
      </p>

      <MapContainer
        center={[32.0853, 34.7818]}
        zoom={14}
        style={{ height: "650px", width: "100%", borderRadius: "12px" }}
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

        {routePoints.length > 0 && <Polyline positions={routePoints} weight={5} />}

        {sampledPoints.map((point, index) => (
          <CircleMarker
            key={`sample-${index}`}
            center={point}
            radius={4}
            pathOptions={{
              color: "gray",
              fillColor: "gray",
              fillOpacity: 0.25,
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
                color: isTopPrediction ? "red" : isTopFive ? "yellow" : "gray",
                fillColor: isTopPrediction ? "red" : isTopFive ? "yellow" : "gray",
                fillOpacity: isTopFive ? 0.9 : 0.45,
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

      <div style={{ marginTop: "16px" }}>
        <p>Start: {start ? JSON.stringify(start) : "not selected"}</p>
        <p>Destination: {destination ? JSON.stringify(destination) : "not selected"}</p>
        <p>
          Current location:{" "}
          {currentLocation ? JSON.stringify(currentLocation) : "not selected"}
        </p>
        <p>
          Snap distance:{" "}
          {snapDistance !== null ? `${snapDistance.toFixed(1)} meters` : "N/A"}
        </p>

        <p>Route points: {routePoints.length}</p>
        <p>Sampled points: {sampledPoints.length}</p>

        {rankedResults.length > 0 && (
          <div>
            <h2>Top Predictions</h2>
            {rankedResults.slice(0, 5).map((result, index) => (
              <p key={index}>
                #{index + 1} | Route index: {result.route_index} | Score:{" "}
                {result.smoothed_similarity.toFixed(4)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;