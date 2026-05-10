import os
import math
import requests
from typing import List, Tuple, Dict, Optional

Point = Tuple[float, float]  # (lat, lon)


def calculate_heading(p1: Point, p2: Point) -> float:
    """Return heading in degrees from p1 to p2."""
    lat1, lon1 = map(math.radians, p1)
    lat2, lon2 = map(math.radians, p2)

    d_lon = lon2 - lon1

    x = math.sin(d_lon) * math.cos(lat2)
    y = (
        math.cos(lat1) * math.sin(lat2)
        - math.sin(lat1) * math.cos(lat2) * math.cos(d_lon)
    )

    heading = math.degrees(math.atan2(x, y))
    return (heading + 360) % 360


def heading_for_route_point(route_points: List[Point], index: int) -> float:
    """Use next point direction, or previous point for the last route point."""
    if len(route_points) < 2:
        return 0.0

    if index < len(route_points) - 1:
        return calculate_heading(route_points[index], route_points[index + 1])

    return calculate_heading(route_points[index - 1], route_points[index])


def download_google_streetview_image(
    point: Point,
    api_key: str,
    save_path: str,
    heading: float = 0.0,
    size: str = "640x640",
    pitch: int = 0,
    fov: int = 90,
) -> bool:
    """
    Downloads one Google Street View image.
    Returns True if saved successfully.
    """

    lat, lon = point

    url = "https://maps.googleapis.com/maps/api/streetview"

    params = {
        "size": size,
        "location": f"{lat},{lon}",
        "heading": heading,
        "pitch": pitch,
        "fov": fov,
        "key": api_key,
    }

    response = requests.get(url, params=params, timeout=30)

    if not response.ok:
        print("Street View request failed:")
        print("Status:", response.status_code)
        print("Response:", response.text)
        return False

    # Google may return an error image if no panorama exists.
    # This check is basic but useful.
    content_type = response.headers.get("Content-Type", "")
    if "image" not in content_type:
        print("Response was not an image:")
        print(response.text)
        return False

    os.makedirs(os.path.dirname(save_path), exist_ok=True)

    with open(save_path, "wb") as f:
        f.write(response.content)

    return True


def extract_images_from_points(
    route_points: List[Point],
    current_point: Point,
    api_key: Optional[str] = None,
    output_dir: str = "streetview_images",
    include_side_views: bool = False,
    current_num_angles: int = 8,
) -> Dict:

    import json

    if api_key is None:
        api_key = os.getenv("GOOGLE_API_KEY")

    if not api_key:
        raise RuntimeError(
            "Missing Google API key. Run:\n"
            "export GOOGLE_API_KEY='your_key_here'"
        )

    os.makedirs(output_dir, exist_ok=True)

    route_results = []

    for i, point in enumerate(route_points):
        heading = heading_for_route_point(route_points, i)

        views = [
            ("forward", heading),
            ("right", (heading + 90) % 360),
            ("backward", (heading + 180) % 360),
            ("left", (heading - 90) % 360),
        ]

        for view_name, view_heading in views:
            image_path = os.path.join(output_dir, f"route_{i:04d}_{view_name}.jpg")

            if os.path.exists(image_path):
                success = True
            else:
                success = download_google_streetview_image(
                    point=point,
                    api_key=api_key,
                    save_path=image_path,
                    heading=view_heading,
                )

            route_results.append({
                "route_index": i,
                "view": view_name,
                "point": point,
                "heading": view_heading,
                "image_path": image_path if success else None,
                "found": success,
            })

    current_results = []

    angle_step = 360 / current_num_angles

    for i in range(current_num_angles):
        heading = i * angle_step
        image_path = os.path.join(output_dir, f"current_{i:02d}_{int(heading):03d}.jpg")

        if os.path.exists(image_path):
            success = True
        else:
            success = download_google_streetview_image(
                point=current_point,
                api_key=api_key,
                save_path=image_path,
                heading=heading,
            )

        current_results.append({
            "current_index": i,
            "point": current_point,
            "heading": heading,
            "image_path": image_path if success else None,
            "found": success,
        })

    result = {
        "route_points": route_points,
        "current_point": current_point,
        "route_images": route_results,
        "current_images": current_results,
    }

    metadata_path = os.path.join(output_dir, "metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(result, f, indent=2)

    result["metadata_path"] = metadata_path

    return result


if __name__ == "__main__":
    import webbrowser

    test_points = [
        (32.0853, 34.7818),
        (32.0860, 34.7825),
        (32.0867, 34.7832),
    ]

    current = test_points[1]

    result = extract_images_from_points(
        route_points=test_points,
        current_point=current,
        output_dir="test_streetview_images",
        include_side_views=False,
    )

    print(result)

    img = result["current_image"]["image_path"]

    if img:
        webbrowser.open("file://" + os.path.abspath(img))