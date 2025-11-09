import os
from typing import List, Tuple
from math import radians, sin, cos, asin, atan2, sqrt
from heapq import heappush, heappop

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import json
from pathlib import Path

# ---- FastAPI app ----
app = FastAPI()

# ---- CORS ----
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "")
allow_origins = [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]
if not allow_origins:
    allow_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Geo helpers ----
KM_TO_NM = 0.539957
NM_TO_KM = 1.0 / KM_TO_NM
R_KM = 6371.0088

def haversine_km(lat1, lon1, lat2, lon2):
    φ1, λ1, φ2, λ2 = map(radians, [lat1, lon1, lat2, lon2])
    dφ = φ2 - φ1
    dλ = λ2 - λ1
    a = sin(dφ/2)**2 + cos(φ1)*cos(φ2)*sin(dλ/2)**2
    c = 2*asin(sqrt(a))
    return R_KM * c

def interpolate_geodesic(lat1, lon1, lat2, lon2, n=128):
    φ1, λ1, φ2, λ2 = map(radians, [lat1, lon1, lat2, lon2])
    d = 2*asin(sqrt(sin((φ2-φ1)/2)**2 + cos(φ1)*cos(φ2)*sin((λ2-λ1)/2)**2))
    if d == 0:
        return [(lon1, lat1)]
    pts = []
    for i in range(n + 1):
        f = i / n
        A = sin((1-f)*d) / sin(d)
        B = sin(f*d) / sin(d)
        x = A*cos(φ1)*cos(λ1) + B*cos(φ2)*cos(λ2)
        y = A*cos(φ1)*sin(λ1) + B*cos(φ2)*sin(λ2)
        z = A*sin(φ1) + B*sin(φ2)
        φi = atan2(z, sqrt(x*x + y*y))
        λi = atan2(y, x)
        pts.append((((λi*180/3.141592653589793)+540)%360-180, φi*180/3.141592653589793))
    return pts

# ---- Models ----
class Waypoint(BaseModel):
    lat: float
    lon: float

class PlanRequest(BaseModel):
    origin: Waypoint
    destination: Waypoint

class HazardCircle(BaseModel):
    lat: float
    lon: float
    radius_nm: float

class AvoidRequest(BaseModel):
    origin: Waypoint
    destination: Waypoint
    hazards: List[HazardCircle] = []
    grid_step_deg: float = 1.0
    penalty_nm: float = 200.0
    max_nodes: int = 200000
    piracy_weight: float = 0.0
    storm_weight: float = 0.0
    depth_penalty_nm: float = 0.0

# ---- Health ----
@app.get("/health")
def health():
    return {"ok": True}

# ---- Great-circle plan ----
@app.post("/plan")
def plan(req: PlanRequest):
    o = req.origin
    d = req.destination
    pts = interpolate_geodesic(o.lat, o.lon, d.lat, d.lon, n=128)
    dist_nm = haversine_km(o.lat, o.lon, d.lat, d.lon) * KM_TO_NM
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": pts},
            "properties": {"distance_nm": round(dist_nm, 2), "algo": "great_circle"},
        }],
    }

# ---- A* Avoid Routing ----
def inside_hazard(lat: float, lon: float, hazards: List[HazardCircle]) -> bool:
    for h in hazards:
        d_km = haversine_km(lat, lon, h.lat, h.lon)
        if d_km * KM_TO_NM <= h.radius_nm:
            return True
    return False

def a_star_route(o: Waypoint, d: Waypoint, step=1.0, hazards=[], penalty_nm=200.0, max_nodes=200000):
    def snap(x, s): return round(x / s) * s
    start = (snap(o.lat, step), snap(o.lon, step))
    goal  = (snap(d.lat, step), snap(d.lon, step))
    dirs = [(0, step), (0, -step), (step, 0), (-step, 0), (step, step), (step, -step), (-step, step), (-step, -step)]
    def h(n): return haversine_km(n[0], n[1], goal[0], goal[1]) * KM_TO_NM

    openq = []
    heappush(openq, (0 + h(start), 0.0, start, None))
    came = {}
    bestg = {start: 0.0}
    visited = 0

    while openq:
        _, g, cur, parent = heappop(openq)
        visited += 1
        if cur in came:
            continue
        came[cur] = parent
        if cur == goal: break
        if visited > max_nodes: break

        for dy, dx in dirs:
            nb = (cur[0] + dy, cur[1] + dx)
            if nb[0] < -89.5 or nb[0] > 89.5: continue
            lon = nb[1]
            if lon < -180: lon += 360
            if lon >  180: lon -= 360
            nb = (nb[0], lon)

            seg_nm = haversine_km(cur[0], cur[1], nb[0], nb[1]) * KM_TO_NM
            cost = seg_nm + (penalty_nm if inside_hazard(nb[0], nb[1], hazards) else 0.0)
            ng = g + cost
            if nb not in bestg or ng < bestg[nb]:
                bestg[nb] = ng
                heappush(openq, (ng + h(nb), ng, nb, cur))

    if goal not in came:
        pts = interpolate_geodesic(o.lat, o.lon, d.lat, d.lon, n=128)
        dist_nm = haversine_km(o.lat, o.lon, d.lat, d.lon) * KM_TO_NM
        return pts, dist_nm, visited, False

    path, cur = [], goal
    while cur is not None:
        path.append(cur); cur = came[cur]
    path.reverse()

    total_nm = 0.0
    coords = []
    for i, node in enumerate(path):
        if i > 0:
            total_nm += haversine_km(path[i-1][0], path[i-1][1], node[0], node[1]) * KM_TO_NM
        coords.append([node[1], node[0]])
    return coords, total_nm, visited, True

@app.post("/plan_avoid")
def plan_avoid(req: AvoidRequest):
    coords, dist_nm, visited, used_astar = a_star_route(
        req.origin, req.destination,
        step=req.grid_step_deg,
        hazards=req.hazards,
        penalty_nm=req.penalty_nm,
        max_nodes=req.max_nodes,
    )
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "distance_nm": round(dist_nm, 2),
                "algo": "astar" if used_astar else "great_circle",
                "visited": visited,
                "grid_step_deg": req.grid_step_deg,
                "hazards": len(req.hazards),
            },
        }],
    }

# ---------- DATA FEEDS ----------
PIRACY_GCS_URL = os.getenv("PIRACY_GCS_URL")  # e.g. https://storage.googleapis.com/hacknation-piracy-nada/piracy.geojson
LOCAL_PIRACY = Path(__file__).parent / "data" / "piracy.geojson"

@app.get("/data/piracy")
async def piracy_feed():
    """
    Try GCS URL (env), then local backend/data/piracy.geojson, else empty FeatureCollection.
    """
    # 1) Try GCS
    if PIRACY_GCS_URL:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(PIRACY_GCS_URL, headers={"Accept": "application/json"})
                r.raise_for_status()
                return JSONResponse(content=r.json())
        except Exception as e:
            # fall through to local file
            pass

    # 2) Try local file
    if LOCAL_PIRACY.exists():
        try:
            with LOCAL_PIRACY.open("r", encoding="utf-8") as f:
                data = json.load(f)
            return JSONResponse(content=data)
        except Exception as e:
            return JSONResponse(content={"error": f"Local piracy.json invalid: {e}"}, status_code=500)

    # 3) Empty but valid GeoJSON
    return {"type": "FeatureCollection", "features": []}

STORMS_SRC = os.getenv("STORMS_SRC", "https://www.nhc.noaa.gov/CurrentStorms.json")

@app.get("/storms")
async def storms():
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(STORMS_SRC, headers={"Accept": "application/json"})
            r.raise_for_status()
            return JSONResponse(content=r.json())
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=502)
