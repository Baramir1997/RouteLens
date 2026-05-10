# RouteLens

Computer vision route-localization prototype.

RouteLens estimates where a user is located along a known route using images instead of GPS.

## Pipeline

1. Create a route between start and destination.
2. Sample points along the route.
3. Download Google Street View images for sampled points.
4. Download/query images for the current location.
5. Use CLIP image embeddings to compare current-location images against sampled route images.
6. Return the most likely route locations.

## Stack

Backend:
- FastAPI
- PyTorch
- Transformers / CLIP
- Google Street View API
- OSRM routing

Frontend:
- React
- Vite
- Leaflet

## Backend setup

```bash
cd backend
pip install -r requirements.txt
export GOOGLE_API_KEY="YOUR_KEY_HERE"
uvicorn main:app --reload
```

Backend runs at:

```text
http://127.0.0.1:8000
```


## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at:

```text
http://localhost:5173
```