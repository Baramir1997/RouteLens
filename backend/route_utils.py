import math
import requests
import polyline
from geopy.distance import geodesic


def get_osrm_route(start, destination):
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
    lat, lon = point
    lat1, lon1 = a
    lat2, lon2 = b

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

    proj_lat = proj_y / 110_540
    proj_lon = proj_x / (111_320 * math.cos(mean_lat))

    return distance, (proj_lat, proj_lon)


def snap_point_to_route(clicked_point, route_points):
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