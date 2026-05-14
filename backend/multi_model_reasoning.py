import os
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from google import genai
from google.genai import types


def _load_image(path: str):
    path = Path(path)
    return types.Part.from_bytes(
        data=path.read_bytes(),
        mime_type="image/jpeg"  # change if you use png
    )


def call_model(
    route: List[Any],
    highest_samples: List[Dict[str, Any]],
    user_images: List[str],
    model_name: str = "gemini-2.5-flash",
) -> Tuple[int, int]:
    """
    route:
        Ordered route points. Example:
        [{"lat": 32.1, "lng": 34.8}, ...]

    highest_samples:
        Top ranked candidate locations.
        Expected example:
        [
            {
                "route_index": 15,
                "score": 0.87,
                "point": {"lat": ..., "lng": ...},
                "images": ["path/to/img1.jpg", "path/to/img2.jpg"]
            }
        ]

    user_images:
        List of image paths from the user's/current location.

    returns:
        (start_index, end_index)
    """

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Missing Gemini API key. Set it with:\n"
            'export GEMINI_API_KEY="YOUR_KEY_HERE"'
        )

    client = genai.Client(api_key=api_key)

    route_summary = [
        {"index": i, "point": point}
        for i, point in enumerate(route)
    ]

    samples_metadata = []
    image_parts = []

    for sample_i, sample in enumerate(highest_samples[:5]):
        samples_metadata.append({
            "sample_id": sample_i,
            "sampled_route_index": sample.get("sampled_route_index"),
            "score": sample.get("score"),
            "point": sample.get("point"),
            "num_images": len(sample.get("images", [])),
        })

        for img_path in sample.get("images", []):
            image_parts.append(
                f"Candidate sample {sample_i}, sampled_route_index={sample.get('sampled_route_index')}"
            )
            image_parts.append(_load_image(img_path))

    for user_i, img_path in enumerate(user_images):
        image_parts.append(f"User/current-location image {user_i}")
        image_parts.append(_load_image(img_path))

    prompt = f"""
You are helping localize a user along a known route.

You are given:
1. The full dense ordered route as dense route indices and coordinates.
2. The top visual retrieval candidates from CLIP/similarity search.
3. Images from those candidate locations.
4. Images from the user's current location.

Important:
- The route list contains dense route points.
- The candidate sampled_route_index values refer to sampled route points, not dense route points.
- Use the candidate coordinates and images as evidence.
- Your final start_index and end_index must be indices from the dense route list.

Your task:
Estimate the smallest route segment that likely contains the user.

Return:
- start_index: index in the route
- end_index: index in the route
- confidence: number from 0 to 1
- reasoning: short explanation

Rules:
- start_index and end_index must be valid dense route indices from the route list.
- start_index must be <= end_index.
- Prefer a short segment, but do not make it so narrow that nearby plausible points are excluded.
- If uncertain, widen the segment around the most plausible candidate points.
- Do not invent coordinates.
- Use visual landmarks, road structure, intersections, sidewalks, lane directions, buildings, signs, vegetation, poles, curves, and scene geometry to improve localization.
- Compare the spatial layout and orientation of the candidate images against the user images.
- Do not rely only on the similarity scores.
- Use the scores as hints, but prioritize consistent visual evidence.
- Return only valid JSON.

ROUTE:
{json.dumps(route_summary, ensure_ascii=False)}

TOP_CANDIDATES:
{json.dumps(samples_metadata, ensure_ascii=False)}
"""

    response = client.models.generate_content(
        model=model_name,
        contents=[prompt, *image_parts],
        config={
            "response_mime_type": "application/json",
            "response_schema": {
                "type": "object",
                "properties": {
                    "start_index": {"type": "integer"},
                    "end_index": {"type": "integer"},
                    "confidence": {"type": "number"},
                    "reasoning": {"type": "string"},
                },
                "required": ["start_index", "end_index", "confidence", "reasoning"],
            },
        },
    )

    result = json.loads(response.text)

    start_index = int(result["start_index"])
    end_index = int(result["end_index"])

    n = len(route)
    start_index = max(0, min(start_index, n - 1))
    end_index = max(0, min(end_index, n - 1))

    if start_index > end_index:
        start_index, end_index = end_index, start_index

    return start_index, end_index