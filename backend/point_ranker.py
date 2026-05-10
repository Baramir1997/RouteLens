import os
from typing import List, Dict

import torch
import torch.nn.functional as F
from PIL import Image
from transformers import CLIPProcessor, CLIPModel


def load_clip_model(model_name: str = "openai/clip-vit-base-patch32"):
    device = "cuda" if torch.cuda.is_available() else "cpu"

    model = CLIPModel.from_pretrained(model_name).to(device)
    processor = CLIPProcessor.from_pretrained(model_name)

    model.eval()

    return model, processor, device

_CACHED_MODEL = None
_CACHED_PROCESSOR = None
_CACHED_DEVICE = None


def get_cached_clip_model():
    global _CACHED_MODEL, _CACHED_PROCESSOR, _CACHED_DEVICE

    if _CACHED_MODEL is None:
        _CACHED_MODEL, _CACHED_PROCESSOR, _CACHED_DEVICE = load_clip_model()

    return _CACHED_MODEL, _CACHED_PROCESSOR, _CACHED_DEVICE

def image_to_vector(image_path: str, model, processor, device):
    image = Image.open(image_path).convert("RGB")

    inputs = processor(
        images=image,
        return_tensors="pt",
    ).to(device)

    with torch.no_grad():
        output = model.get_image_features(**inputs)

        if hasattr(output, "pooler_output"):
            vector = output.pooler_output
        elif hasattr(output, "last_hidden_state"):
            vector = output.last_hidden_state[:, 0, :]
        else:
            vector = output

    vector = F.normalize(vector, p=2, dim=1)

    return vector.squeeze(0).cpu()

def rank_points_by_image_similarity(
    route_images: List[Dict],
    current_images: List[Dict],
    top_k: int = 5,
) -> List[Dict]:

    model, processor, device = get_cached_clip_model()

    current_vectors = []

    for current_image in current_images:
        if not current_image.get("found") or not current_image.get("image_path"):
            continue

        current_vectors.append({
            "heading": current_image.get("heading"),
            "image_path": current_image.get("image_path"),
            "vector": image_to_vector(
                current_image["image_path"],
                model,
                processor,
                device,
            ),
        })

    if not current_vectors:
        raise ValueError("No valid current-location images found.")

    grouped = {}

    for item in route_images:
        if not item.get("found") or not item.get("image_path"):
            continue

        image_path = item["image_path"]

        if not os.path.exists(image_path):
            continue

        route_index = item.get("route_index")
        point = item.get("point")

        route_vector = image_to_vector(image_path, model, processor, device)

        current_scores = []

        for current in current_vectors:
            similarity = torch.dot(current["vector"], route_vector).item()

            current_scores.append({
                "similarity": similarity,
                "current_heading": current["heading"],
                "current_image_path": current["image_path"],
            })

        current_scores.sort(key=lambda x: x["similarity"], reverse=True)

        best_match = current_scores[0]

        route_image_score = {
            "route_view": item.get("view"),
            "route_heading": item.get("heading"),
            "route_image_path": image_path,
            "score": best_match["similarity"],
            "best_current_heading": best_match["current_heading"],
            "best_current_image_path": best_match["current_image_path"],
            "all_current_scores": current_scores,
        }

        if route_index not in grouped:
            grouped[route_index] = {
                "route_index": route_index,
                "point": point,
                "route_image_scores": [],
            }

        grouped[route_index]["route_image_scores"].append(route_image_score)

    results = []

    for route_index, group in grouped.items():
        scores = group["route_image_scores"]

        if not scores:
            continue

        sorted_scores = sorted(
            scores,
            key=lambda x: x["score"],
            reverse=True,
        )

        top_scores = sorted_scores[:2]

        avg_score = sum(x["score"] for x in top_scores) / len(top_scores)

        best_image = sorted_scores[0]

        results.append({
            "route_index": route_index,
            "point": group["point"],
            "similarity": avg_score,
            "smoothed_similarity": avg_score,
            "num_route_images": len(scores),
            "best_route_image_path": best_image["route_image_path"],
            "best_current_image_path": best_image["best_current_image_path"],
            "best_current_heading": best_image["best_current_heading"],
            "route_image_scores": scores,
        })

    for result in results:
        result["smoothed_similarity"] = result["similarity"]

    results.sort(key=lambda x: x["smoothed_similarity"], reverse=True)

    return results[:top_k]