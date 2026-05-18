import json
import re
import shutil
import time
from pathlib import Path
from typing import Dict, List, Tuple

import torch

from image_extraction import extract_images_from_points
from point_ranker import get_cached_clip_model, image_to_vector

Point = Tuple[float, float]

CACHE_ROOT = Path("offline_route_caches")
UPLOAD_ROOT = Path("offline_uploads")


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-").lower()
    return slug or "route"


def _cache_dir(cache_id: str) -> Path:
    return CACHE_ROOT / cache_id


def prepare_route_cache(
    sampled_points: List[Point],
    cache_name: str = "Route cache",
) -> Dict:
    cache_id = f"{int(time.time())}_{_safe_slug(cache_name)}"
    cache_dir = _cache_dir(cache_id)
    image_dir = cache_dir / "images"
    cache_dir.mkdir(parents=True, exist_ok=True)

    image_result = extract_images_from_points(
        route_points=sampled_points,
        current_point=None,
        output_dir=str(image_dir),
        include_side_views=True,
        current_num_angles=0,
    )

    model, processor, device = get_cached_clip_model()
    route_items = []
    vectors = []

    for item in image_result["route_images"]:
        image_path = item.get("image_path")

        if not item.get("found") or not image_path or not Path(image_path).exists():
            continue

        vector = image_to_vector(image_path, model, processor, device)
        vectors.append(vector)
        route_items.append({
            "route_index": item.get("route_index"),
            "point": item.get("point"),
            "view": item.get("view"),
            "heading": item.get("heading"),
            "image_path": image_path,
        })

    if not vectors:
        shutil.rmtree(cache_dir, ignore_errors=True)
        raise ValueError("No Street View route images were downloaded for this cache.")

    embedding_path = cache_dir / "embeddings.pt"
    torch.save(
        {
            "vectors": torch.stack(vectors),
            "items": route_items,
        },
        embedding_path,
    )

    metadata = {
        "cache_id": cache_id,
        "cache_name": cache_name,
        "created_at": int(time.time()),
        "sampled_points": sampled_points,
        "num_sampled_points": len(sampled_points),
        "num_route_images": len(route_items),
        "metadata_path": str(cache_dir / "metadata.json"),
        "embedding_path": str(embedding_path),
    }

    with open(cache_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    return metadata


def list_route_caches() -> List[Dict]:
    if not CACHE_ROOT.exists():
        return []

    caches = []

    for metadata_path in CACHE_ROOT.glob("*/metadata.json"):
        with open(metadata_path) as f:
            caches.append(json.load(f))

    caches.sort(key=lambda item: item.get("created_at", 0), reverse=True)
    return caches


def localize_uploaded_image(cache_id: str, upload_file, top_k: int = 5) -> Dict:
    cache_dir = _cache_dir(cache_id)
    embedding_path = cache_dir / "embeddings.pt"
    metadata_path = cache_dir / "metadata.json"

    if not embedding_path.exists() or not metadata_path.exists():
        raise FileNotFoundError(f"Offline cache not found: {cache_id}")

    with open(metadata_path) as f:
        metadata = json.load(f)

    upload_dir = UPLOAD_ROOT / cache_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    extension = Path(upload_file.filename or "query.jpg").suffix or ".jpg"
    query_path = upload_dir / f"query_{int(time.time())}{extension}"

    with open(query_path, "wb") as f:
        shutil.copyfileobj(upload_file.file, f)

    model, processor, device = get_cached_clip_model()
    query_vector = image_to_vector(str(query_path), model, processor, device)

    cache_data = torch.load(embedding_path, map_location="cpu")
    route_vectors = cache_data["vectors"]
    route_items = cache_data["items"]

    scores = torch.mv(route_vectors, query_vector)
    ranked_indices = torch.argsort(scores, descending=True)

    grouped = {}

    for tensor_index in ranked_indices.tolist():
        item = route_items[tensor_index]
        route_index = item["route_index"]
        score = float(scores[tensor_index].item())

        if route_index not in grouped:
            grouped[route_index] = {
                "route_index": route_index,
                "point": item["point"],
                "similarity": score,
                "smoothed_similarity": score,
                "best_route_image_path": item["image_path"],
                "route_image_scores": [],
            }

        grouped[route_index]["route_image_scores"].append({
            "route_view": item["view"],
            "route_heading": item["heading"],
            "route_image_path": item["image_path"],
            "score": score,
        })

    ranked_results = sorted(
        grouped.values(),
        key=lambda item: item["smoothed_similarity"],
        reverse=True,
    )[:top_k]

    best_score = ranked_results[0]["smoothed_similarity"] if ranked_results else 0.0
    second_score = ranked_results[1]["smoothed_similarity"] if len(ranked_results) > 1 else 0.0
    confidence = max(0.0, min(1.0, (best_score + max(0.0, best_score - second_score)) / 2))

    return {
        "cache": metadata,
        "query_image_path": str(query_path),
        "ranked_results": ranked_results,
        "estimated_point": ranked_results[0]["point"] if ranked_results else None,
        "confidence": confidence,
    }
