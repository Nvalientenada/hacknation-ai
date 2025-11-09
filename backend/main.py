import os
from typing import List, Tuple
from math import radians, sin, cos, asin, atan2, sqrt
from heapq import heappush, heappop

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---- FastAPI app ----
app = FastAPI()

# ---- CORS ----
# Allow Vercel domain and localhost by default. You can customize with env.
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "")
allow_origins = [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]
if not allow_origins:
    # fallback for dev/demo
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
    """Great-circle distance between two lat/lon in KM."""
    φ1, λ1, φ2, λ2 = map(radians, [lat1, lon1, lat2, lon2])
    dφ = φ2 - φ1
    dλ = λ2 - λ1
    a = sin(dφ/2)**2 + cos(φ1)*cos(φ2)*sin(dλ/2)**2
    c = 2*asin(sqrt(a))
    return R_KM * c

def interpolate_geodesic(lat1, lon1, lat2, lon2, n=128) -> List[Tuple[float, float]]:
    """Interpolate n points along great-circle from (lat1,lon1) to (lat2,lon2)."""
    φ1, λ1, φ2, λ2 = map(radians, [lat1, lon1, lat2, lon2])
    d = 2*asin(sqrt(sin((φ2-φ1)/2)**2 + cos(φ1)*cos(φ2)*sin((λ2-λ1)/2)**2))
    if d == 0:
        return [(lon1, lat1)]
    points = []
    for i in range(n + 1):
        f = i / n
        A = sin((1-f)*d) / sin(d)
        B = sin(f*d) / sin(d)
        x = A*cos(φ1)*cos(λ1) + B*cos(φ2)*cos(λ2)
        y = A*cos(φ1)*sin(λ1) + B*cos(φ2)*sin(λ2)
        z = A*sin(φ1) + B*sin(φ2)
        φi = atan2(z, sqrt(x*x + y*y))
        λi = atan2(y, x)
        points.append((((λi*180/3.141592653589793)+540)%360-180, φi*180/3.141592653589793))
    return points

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
    # New weights
    piracy_weight: float = 0.0   # 0..1
    storm_weight: float = 0.0    # 0..1
    depth_penalty_nm: float = 0.0  # absolute nm added per step (demo)

# ---- Endpoints ----
@app.get("/health")
def health():
    return {"ok": True}

@app.post("/plan")
def plan(req: PlanRequest):
    o = req.origin
    d = req.destination
    pts = interpolate_geodesic(o.lat, o.lon, d.lat, d.lon, n=128)
    dist_nm = haversine_km(o.lat, o.lon, d.lat, d.lon) * KM_TO_NM
    feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": pts},
        "properties": {
            "distance_nm": round(dist_nm, 2),
            "algo": "great_circle",
        },
    }
    return {"type": "FeatureCollection", "features": [feature]}

# ---- A* Avoid Routing ----
def inside_hazard(lat: float, lon: float, hazards: List[HazardCircle]) -> bool:
    for h in hazards:
        d_km = haversine_km(lat, lon, h.lat, h.lon)
        if d_km * KM_TO_NM <= h.radius_nm:
            return True
    return False

def a_star_route(
    o: Waypoint,
    d: Waypoint,
    step=1.0,
    hazards: List[HazardCircle] = [],
    penalty_nm: float = 200.0,
    max_nodes: int = 200000,
    piracy_weight: float = 0.0,
    storm_weight: float = 0.0,
    depth_penalty_nm: float = 0.0,
):
    """
    A* on a lat/lon grid. Edge cost =
      base distance (nm)
      + piracy penalty (if inside hazard circle) scaled by piracy_weight
      + storm penalty (demo: tropical band) scaled by storm_weight
      + depth penalty (demo: constant tiny nm)
    """
    def snap(x, s):
        return round(x / s) * s

    start = (snap(o.lat, step), snap(o.lon, step))
    goal  = (snap(d.lat, step), snap(d.lon, step))

    dirs = [
        (0, step), (0, -step),
        (step, 0), (-step, 0),
        (step, step), (step, -step), (-step, step), (-step, -step)
    ]

    def h(n):
        return haversine_km(n[0], n[1], goal[0], goal[1]) * KM_TO_NM

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
        if cur == goal:
            break
        if visited > max_nodes:
            break

        for dy, dx in dirs:
            nb = (cur[0] + dy, cur[1] + dx)

            # Latitude bounds & wrap longitude
            if nb[0] < -89.5 or nb[0] > 89.5:
                continue
            lon = nb[1]
            if lon < -180: lon += 360
            if lon >  180: lon -= 360
            nb = (nb[0], lon)

            seg_nm = haversine_km(cur[0], cur[1], nb[0], nb[1]) * KM_TO_NM
            cost = seg_nm

            # Piracy penalty (inside circle → apply scaled penalty)
            if piracy_weight > 0 and inside_hazard(nb[0], nb[1], hazards):
                cost += penalty_nm * piracy_weight

            # Storm penalty (demo heuristic: tropical band)
            # If in 10°–25° absolute latitude, apply a smaller penalty.
            if storm_weight > 0:
                if 10 <= abs(nb[0]) <= 25:
                    cost += penalty_nm * 0.15 * storm_weight

            # Depth penalty (demo): small constant to illustrate trade-off
            if depth_penalty_nm > 0:
                cost += depth_penalty_nm * 0.01

            ng = g + cost
            if nb not in bestg or ng < bestg[nb]:
                bestg[nb] = ng
                heappush(openq, (ng + h(nb), ng, nb, cur))

    # reconstruct
    if goal not in came:
        # fallback to great-circle
        pts = interpolate_geodesic(o.lat, o.lon, d.lat, d.lon, n=128)
        dist_nm = haversine_km(o.lat, o.lon, d.lat, d.lon) * KM_TO_NM
        return pts, dist_nm, visited, False

    path = []
    cur = goal
    while cur is not None:
        path.append(cur)
        cur = came[cur]
    path.reverse()

    # length
    total_nm = 0.0
    coords = []
    for i, node in enumerate(path):
        if i > 0:
            total_nm += haversine_km(path[i-1][0], path[i-1][1], node[0], node[1]) * KM_TO_NM
        coords.append([node[1], node[0]])  # [lon, lat]
    return coords, total_nm, visited, True

@app.post("/plan_avoid")
def plan_avoid(req: AvoidRequest):
    coords, dist_nm, visited, used_astar = a_star_route(
        req.origin,
        req.destination,
        step=req.grid_step_deg,
        hazards=req.hazards,
        penalty_nm=req.penalty_nm,
        max_nodes=req.max_nodes,
        piracy_weight=req.piracy_weight,
        storm_weight=req.storm_weight,
        depth_penalty_nm=req.depth_penalty_nm,
    )
    feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {
            "distance_nm": round(dist_nm, 2),
            "algo": "astar" if used_astar else "great_circle",
            "visited": visited,
            "grid_step_deg": req.grid_step_deg,
            "hazards": len(req.hazards),
            "piracy_weight": req.piracy_weight,
            "storm_weight": req.storm_weight,
            "depth_penalty_nm": req.depth_penalty_nm,
        },
    }
    return {"type": "FeatureCollection", "features": [feature]}
