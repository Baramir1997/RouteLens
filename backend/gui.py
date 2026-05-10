import math
import requests
import streamlit as st
import folium
import polyline
from geopy.distance import geodesic
from streamlit_folium import st_folium
import json
from image_extraction import extract_images_from_points
from point_ranker import rank_points_by_image_similarity

def get_osrm_route(start, destination):
    """
    start/destination format: (lat, lon)
    Returns route points as [(lat, lon), ...]
    """
    start_lat, start_lon = start
    dest_lat, dest_lon = destination

    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{start_lon},{start_lat};{dest_lon},{dest_lat}"
        "?overview=full&geometries=polyline"
    )

    response = requests.get(url, timeout=20)
    response.raise_for_status()
    data = response.json()

    if data["code"] != "Ok":
        raise RuntimeError(f"OSRM error: {data}")

    encoded_geometry = data["routes"][0]["geometry"]
    return polyline.decode(encoded_geometry)


def sample_route_every_meters(route_points, step_meters=100):
    """
    Takes dense route polyline points and returns points every ~step_meters.
    """
    if not route_points:
        return []

    sampled = [route_points[0]]
    distance_since_last = 0.0

    for i in range(1, len(route_points)):
        prev = route_points[i - 1]
        curr = route_points[i]
        segment_distance = geodesic(prev, curr).meters
        distance_since_last += segment_distance

        if distance_since_last >= step_meters:
            sampled.append(curr)
            distance_since_last = 0.0

    if sampled[-1] != route_points[-1]:
        sampled.append(route_points[-1])

    return sampled


def point_to_segment_distance_meters(point, a, b):
    """
    Approximate distance from point to route segment a-b.
    Good enough for snapping clicked point to nearest route sample/segment.
    """
    lat, lon = point
    lat1, lon1 = a
    lat2, lon2 = b

    # Convert lat/lon to local flat coordinates in meters.
    mean_lat = math.radians((lat + lat1 + lat2) / 3)
    x = lon * 111_320 * math.cos(mean_lat)
    y = lat * 110_540
    x1 = lon1 * 111_320 * math.cos(mean_lat)
    y1 = lat1 * 110_540
    x2 = lon2 * 111_320 * math.cos(mean_lat)
    y2 = lat2 * 110_540

    dx = x2 - x1
    dy = y2 - y1

    if dx == 0 and dy == 0:
        return math.sqrt((x - x1) ** 2 + (y - y1) ** 2), a

    t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy

    distance = math.sqrt((x - proj_x) ** 2 + (y - proj_y) ** 2)

    # Convert projected point approximately back to lat/lon.
    proj_lat = proj_y / 110_540
    proj_lon = proj_x / (111_320 * math.cos(mean_lat))

    return distance, (proj_lat, proj_lon)


def snap_point_to_route(clicked_point, route_points):
    """
    Returns the closest point on the route to the user's clicked point.
    """
    best_distance = float("inf")
    best_snapped_point = None

    for i in range(1, len(route_points)):
        dist, snapped = point_to_segment_distance_meters(
            clicked_point,
            route_points[i - 1],
            route_points[i],
        )

        if dist < best_distance:
            best_distance = dist
            best_snapped_point = snapped

    return best_snapped_point, best_distance


def route_picker_gui(default_center=(32.0853, 34.7818), step_meters=100):
    """
    Streamlit GUI:
    1. Click start.
    2. Click destination.
    3. Generate route.
    4. Click current location near/on route.
    5. Returns:
       - current_location: (lat, lon)
       - sampled_route_points: [(lat, lon), ...] every ~100 meters
    """

    st.title("Visual Route Localization - Route Picker")

    if "start" not in st.session_state:
        st.session_state.start = None
    if "destination" not in st.session_state:
        st.session_state.destination = None
    if "route_points" not in st.session_state:
        st.session_state.route_points = []
    if "sampled_points" not in st.session_state:
        st.session_state.sampled_points = []
    if "current_location" not in st.session_state:
        st.session_state.current_location = None
    if "mode" not in st.session_state:
        st.session_state.mode = "start"

    col1, col2, col3, col4 = st.columns(4)

    with col1:
        if st.button("Choose start"):
            st.session_state.mode = "start"

    with col2:
        if st.button("Choose destination"):
            st.session_state.mode = "destination"

    with col3:
        if st.button("Choose current location"):
            st.session_state.mode = "current"

    with col4:
        if st.button("Reset"):
            st.session_state.start = None
            st.session_state.destination = None
            st.session_state.route_points = []
            st.session_state.sampled_points = []
            st.session_state.current_location = None
            st.session_state.mode = "start"
            st.rerun()

    st.write(f"Current mode: **{st.session_state.mode}**")

    # Map center
    center = default_center
    if st.session_state.start:
        center = st.session_state.start

    m = folium.Map(location=center, zoom_start=14)

    # Draw selected markers
    if st.session_state.start:
        folium.Marker(
            st.session_state.start,
            tooltip="Start",
            icon=folium.Icon(color="green"),
        ).add_to(m)

    if st.session_state.destination:
        folium.Marker(
            st.session_state.destination,
            tooltip="Destination",
            icon=folium.Icon(color="red"),
        ).add_to(m)

    if st.session_state.current_location:
        folium.Marker(
            st.session_state.current_location,
            tooltip="Current location",
            icon=folium.Icon(color="blue"),
        ).add_to(m)

    # Draw route
    if st.session_state.route_points:
        folium.PolyLine(
            st.session_state.route_points,
            tooltip="Generated route",
            weight=5,
        ).add_to(m)

    # Draw sampled points
    for idx, p in enumerate(st.session_state.sampled_points):
        folium.CircleMarker(
            location=p,
            radius=3,
            tooltip=f"Sample {idx}",
            fill=True,
        ).add_to(m)

    map_data = st_folium(m, height=650, width=1000)

    clicked = map_data.get("last_clicked")

    if clicked:
        clicked_point = (clicked["lat"], clicked["lng"])

        if st.session_state.mode == "start":
            st.session_state.start = clicked_point
            st.session_state.mode = "destination"
            st.rerun()

        elif st.session_state.mode == "destination":
            st.session_state.destination = clicked_point

            if st.session_state.start and st.session_state.destination:
                with st.spinner("Generating route..."):
                    route_points = get_osrm_route(
                        st.session_state.start,
                        st.session_state.destination,
                    )
                    sampled_points = sample_route_every_meters(
                        route_points,
                        step_meters=step_meters,
                    )

                st.session_state.route_points = route_points
                st.session_state.sampled_points = sampled_points
                st.session_state.mode = "current"

            st.rerun()

        elif st.session_state.mode == "current":
            if st.session_state.route_points:
                snapped, distance = snap_point_to_route(
                    clicked_point,
                    st.session_state.route_points,
                )
                st.session_state.current_location = snapped
                st.success(f"Snapped to route. Distance from click: {distance:.1f} meters.")
            else:
                st.session_state.current_location = clicked_point

            st.rerun()

    st.subheader("Returned values")

    st.write("Current location:")
    st.json(st.session_state.current_location)

    st.write(f"Sampled route points every ~{step_meters} meters:")
    st.json(st.session_state.sampled_points)

    route_saved = False

    if st.button("Save selected route"):
        if st.session_state.current_location is None:
            st.error("Choose current location first.")
        elif not st.session_state.sampled_points:
            st.error("Create a route first.")
        else:
            st.session_state.route_saved = True
            st.session_state.saved_current_location = st.session_state.current_location
            st.session_state.saved_sampled_points = st.session_state.sampled_points
            route_saved = True
            st.success("Route saved. Pipeline can continue.")

    return (
        st.session_state.get("saved_current_location"),
        st.session_state.get("saved_sampled_points"),
        st.session_state.get("route_saved", False),
    )

def draw_results_map(sampled_points, current_location, ranked_results):
    center = current_location or sampled_points[0]

    m = folium.Map(location=center, zoom_start=15)

    # Full sampled route
    folium.PolyLine(
        sampled_points,
        tooltip="Route",
        weight=5,
    ).add_to(m)

    # Current true location
    folium.Marker(
        current_location,
        tooltip="Actual current location",
        icon=folium.Icon(color="green"),
    ).add_to(m)

    # Top ranked points
    for rank, result in enumerate(ranked_results, start=1):
        point = result["point"]
        similarity = result["smoothed_similarity"]
        route_index = result["route_index"]

        color = "red" if rank == 1 else "blue"

        folium.Marker(
            point,
            tooltip=f"Rank {rank} | Route index {route_index} | Similarity {similarity:.4f}",
            popup=f"Rank {rank}<br>Similarity: {similarity:.4f}<br>Route index: {route_index}",
            icon=folium.Icon(color=color),
        ).add_to(m)

    st_folium(m, height=650, width=1000)


def pipeline():
    current_location, sampled_points, route_saved = route_picker_gui(step_meters=100)

    if not route_saved:
        st.info("Choose start, destination, current location, then press Save selected route.")
        return

    st.subheader("Pipeline started")

    st.write("Saved current location:")
    st.write(current_location)

    st.write("Saved sampled route points:")
    st.write(sampled_points)

    if st.button("Extract images and rank locations"):
        with st.spinner("Extracting Street View images..."):
            image_result = extract_images_from_points(
                route_points=sampled_points,
                current_point=current_location,
                output_dir="streetview_images",
                include_side_views=False,
                current_num_angles=8,
            )

        st.session_state.image_result = image_result

        with st.spinner("Ranking route points by image similarity..."):
            ranked_results = rank_points_by_image_similarity(
                route_images=image_result["route_images"],
                current_images=image_result["current_images"],
                top_k=5,
            )

        st.session_state.ranked_results = ranked_results

    if "ranked_results" in st.session_state:
        ranked_results = st.session_state.ranked_results

        st.subheader("Top 5 predicted locations")

        for rank, result in enumerate(ranked_results, start=1):
            st.write(
                f"{rank}. Route index: {result['route_index']} | "
                f"Similarity: {result['similarity']:.4f} | "
                f"Point: {result['point']}"
            )

        st.subheader("Ranked locations on map")
        draw_results_map(
            sampled_points=sampled_points,
            current_location=current_location,
            ranked_results=ranked_results,
        )

if __name__ == "__main__":
    pipeline()