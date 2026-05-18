import time

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from route_utils import (
    get_osrm_route,
    sample_route_every_meters,
    snap_point_to_route,
)
from image_extraction import extract_images_from_points
from point_ranker import rank_points_by_image_similarity
from multi_model_reasoning import call_model
from offline_cache import (
    list_route_caches,
    localize_uploaded_image,
    prepare_route_cache,
)


app = FastAPI()

app.mount(
    "/files/streetview",
    StaticFiles(directory="streetview_images", check_dir=False),
    name="streetview_images",
)
app.mount(
    "/files/offline-caches",
    StaticFiles(directory="offline_route_caches", check_dir=False),
    name="offline_route_caches",
)
app.mount(
    "/files/offline-uploads",
    StaticFiles(directory="offline_uploads", check_dir=False),
    name="offline_uploads",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RouteRequest(BaseModel):
    start: list[float]
    destination: list[float]
    step_meters: int = 100


class SnapRequest(BaseModel):
    clicked_point: list[float]
    route_points: list[list[float]]


class ExtractAndRankRequest(BaseModel):
    sampled_points: list[list[float]]
    current_location: list[float]


class PrepareOfflineCacheRequest(BaseModel):
    sampled_points: list[list[float]]
    cache_name: str = "Route cache"


class ReasoningRequest(BaseModel):
    route_points: list[list[float]]
    sampled_points: list[list[float]]
    ranked_results: list[dict]
    current_images: list[dict]    


@app.get("/")
def root():
    return {"message": "Backend is working"}


@app.post("/api/route")
def create_route(request: RouteRequest):
    route_points = get_osrm_route(
        tuple(request.start),
        tuple(request.destination),
    )

    sampled_points = sample_route_every_meters(
        route_points,
        step_meters=request.step_meters,
    )

    return {
        "route_points": route_points,
        "sampled_points": sampled_points,
    }


@app.post("/api/snap")
def snap_current_location(request: SnapRequest):
    snapped_point, distance_meters = snap_point_to_route(
        tuple(request.clicked_point),
        [tuple(p) for p in request.route_points],
    )

    return {
        "snapped_point": snapped_point,
        "distance_meters": distance_meters,
    }


@app.post("/api/extract-and-rank")
def extract_and_rank(request: ExtractAndRankRequest):
    # Use a fresh folder every run so old Street View images do not corrupt results.
    output_dir = f"streetview_images/run_{int(time.time())}"

    image_result = extract_images_from_points(
        route_points=[tuple(p) for p in request.sampled_points],
        current_point=tuple(request.current_location),
        output_dir=output_dir,
        include_side_views=True,
        current_num_angles=8,
    )

    ranked_results = rank_points_by_image_similarity(
        route_images=image_result["route_images"],
        current_images=image_result["current_images"],
        top_k=999999,
    )

    return {
        "ranked_results": ranked_results,
        "current_images": image_result["current_images"],
        "metadata_path": image_result["metadata_path"],
        "output_dir": output_dir,
    }


@app.post("/api/offline/prepare-cache")
def prepare_offline_cache(request: PrepareOfflineCacheRequest):
    return prepare_route_cache(
        sampled_points=[tuple(p) for p in request.sampled_points],
        cache_name=request.cache_name,
    )


@app.get("/api/offline/caches")
def get_offline_caches():
    return {"caches": list_route_caches()}


@app.post("/api/offline/localize")
def offline_localize(
    cache_id: str = Form(...),
    image: UploadFile = File(...),
):
    return localize_uploaded_image(
        cache_id=cache_id,
        upload_file=image,
        top_k=10,
    )


@app.post("/api/apply-reasoning")
def apply_reasoning(request: ReasoningRequest):
    top_5 = request.ranked_results[:5]

    highest_samples = []

    for result in top_5:
        route_images = [
            score["route_image_path"]
            for score in result["route_image_scores"]
        ]

        highest_samples.append({
            "sampled_route_index": result["route_index"],
            "score": result["smoothed_similarity"],
            "point": result["point"],
            "images": route_images,
        })

    user_images = [
        img["image_path"]
        for img in request.current_images
        if img.get("found") and img.get("image_path")
    ]

    start_index, end_index = call_model(
        route=request.route_points,
        highest_samples=highest_samples,
        user_images=user_images,
    )

    if start_index == end_index:
        if end_index < len(request.route_points) - 1:
            end_index += 1
        elif start_index > 0:
            start_index -= 1


    return {
        "reasoning_start_index": start_index,
        "reasoning_end_index": end_index,
         "reasoning_points": request.route_points[start_index:end_index + 1],
    }
