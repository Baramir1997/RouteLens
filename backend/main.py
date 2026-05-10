import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from route_utils import (
    get_osrm_route,
    sample_route_every_meters,
    snap_point_to_route,
)
from image_extraction import extract_images_from_points
from point_ranker import rank_points_by_image_similarity


app = FastAPI()

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
        "metadata_path": image_result["metadata_path"],
        "output_dir": output_dir,
    }