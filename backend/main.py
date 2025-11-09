import os
from typing import List, Tuple, Dict, Iterable, Optional
from math import radians, sin, cos, asin, atan2, sqrt, floor

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from heapq import heappush, heappop
import json

# ------------------------------------------------------------------------------
# FastAPI app + CORS
# ------------------------------------------------------------------------------
app = FastAPI()

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

# ------------------------------------------------------------------------------
# Geo helpers
# ------------------------------------------------------------------------------
KM_TO_NM = 0.539957
NM_TO_KM = 1.0 / KM_TO_NM
R_KM = 6371.0088
R_M  = R_KM * 1000.0

def haversine_km(lat1, lon1, lat2, lon2):
    φ1, λ1, φ2, λ2 = map(radians, [lat1, lon1, lat2, lon2])
    dφ = φ2 - φ1
    dλ = λ2 - λ1
    a = sin(dφ/2)**2 + cos(φ1)*cos(φ2)*sin(dλ/2)**2
    c = 2*asin(sqrt(a))
    return R_KM * c

def interpolate_geodesic(lat1, lon1, lat2, lon2, n=128) -> List[Tuple[float, float]]:
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
        # normalize lon to [-180,180)
        points.append((((λi*180/3.141592653589793)+540)%360-180, φi*180/3.141592653589793))
    return points

# ------------------------------------------------------------------------------
# Models
# ------------------------------------------------------------------------------
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
    piracy_weight: float = 0.0   # 0..1
    storm_weight: float = 0.0    # placeholder (not used yet)
    depth_penalty_nm: float = 0.0 # placeholder (not used yet)

# ------------------------------------------------------------------------------
# Piracy index (lightweight grid for nearest search)
# ------------------------------------------------------------------------------
class PiracyIndex:
    """
    Very lightweight spatial index: bucket incidents into lat/lon grid cells.
    Search nearest by checking the incident cell and its neighbors out to k rings.
    """
    def __init__(self, cell_deg: float = 1.0):
        self.cell = cell_deg
        self.points: List[Tuple[float,float,dict]] = []  # (lat, lon, props)
        self.grid: Dict[Tuple[int,int], List[int]] = {}

    def _key(self, lat: float, lon: float) -> Tuple[int,int]:
        return (floor((lat + 90.0) / self.cell), floor((lon + 180.0) / self.cell))

    def load_geojson(self, gj: dict):
        pts: List[Tuple[float,float,dict]] = []
        def add(lat: float, lon: float, props: dict):
            idx = len(pts)
            pts.append((lat, lon, props))
            key = self._key(lat, lon)
            self.grid.setdefault(key, []).append(idx)

        if gj.get("type") == "FeatureCollection":
            for feat in gj.get("features", []):
                geom = feat.get("geometry", {})
                props = feat.get("properties", {}) or {}
                gtype = geom.get("type")
                if gtype == "Point":
                    lon, lat = geom.get("coordinates", [None, None])[:2]
                    if lat is not None and lon is not None:
                        add(lat, lon, props)
                elif gtype == "MultiPoint":
                    for lon, lat in geom.get("coordinates", []):
                        add(lat, lon, props)
                # if Polygon risk zones are present, we just expose them; distance is based on points for now
        self.points = pts

    def nearest_nm(self, lat: float, lon: float, max_rings: int = 3) -> Optional[float]:
        if not self.points:
            return None
        base_key = self._key(lat, lon)
        best_nm: Optional[float] = None

        for ring in range(max_rings + 1):
            # iterate cells in the square ring around base_key
            for dy in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    if ring > 0 and abs(dy) < ring and abs(dx) < ring:
                        continue  # only border of the ring
                    cell = (base_key[0] + dy, base_key[1] + dx)
                    idxs = self.grid.get(cell)
                    if not idxs:
                        continue
                    for i in idxs:
                        plat, plon, _ = self.points[i]
                        d_km = haversine_km(lat, lon, plat, plon)
                        d_nm = d_km * KM_TO_NM
                        if best_nm is None or d_nm < best_nm:
                            best_nm = d_nm
            if best_nm is not None:
                return best_nm
        return None

# Global piracy index + data payload served to frontend
PIRACY_PATH = os.getenv("DATA_PIRACY_PATH", "data/piracy.geojson")
piracy_index = PiracyIndex(cell_deg=1.0)
piracy_geojson_cache: Optional[dict] = None

def _load_piracy_from_disk() -> dict:
    with open(PIRACY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def ensure_piracy_loaded():
    global piracy_geojson_cache
    if piracy_geojson_cache is None:
        try:
            gj = _load_piracy_from_disk()
            piracy_index.load_geojson(gj)
            piracy_geojson_cache = gj
            print(f"[piracy] loaded {len(piracy_index.points)} point incidents from {PIRACY_PATH}")
        except Exception as e:
            piracy_geojson_cache = {"type":"FeatureCollection","features":[]}
            print(f"[piracy] failed to load ({e}); continuing with empty set")

# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"ok": True}

@app.get("/data/piracy")
def get_piracy():
    ensure_piracy_loaded()
    return piracy_geojson_cache

@app.post("/plan")
def plan(req: PlanRequest):
    o = req.origin
    d = req.destination
    pts = interpolate_geodesic(o.lat, o.lon, d.lat, d.lon, n=128)
    dist_nm = haversine_km(o.lat, o.lon, d.lat, d.lon) * KM_TO_NM
    feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": pts},
        "properties": {"distance_nm": round(dist_nm, 2), "algo": "great_circle"},
    }
    return {"type": "FeatureCollection", "features": [feature]}

# ---- A* Avoid Routing with piracy proximity penalty ----
def inside_hazard(lat: float, lon: float, hazards: List[HazardCircle]) -> bool:
    for h in hazards:
        d_km = haversine_km(lat, lon, h.lat, h.lon)
        if d_km * KM_TO_NM <= h.radius_nm:
            return True
    return False

def piracy_penalty_nm(lat: float, lon: float, weight: float) -> float:
    """Penalty grows when close to nearest piracy incident.
    Within 100 nm: linear penalty up to 500 nm * weight.
    Beyond 300 nm: ~0. Between 100..300 nm: taper to 0.
    """
    if weight <= 0.0:
        return 0.0
    ensure_piracy_loaded()
    d = piracy_index.nearest_nm(lat, lon)
    if d is None:
        return 0.0

    # piecewise linear penalty shape (hackathon-friendly and tunable)
    if d <= 100:
        base = 500.0 * (1.0 - (d / 100.0))  # 0..500
    elif d <= 300:
        base = 100.0 * (1.0 - (d - 100.0) / 200.0)  # 100→0
    else:
        base = 0.0
    return base * max(0.0, min(1.0, weight))

def a_star_route(o: Waypoint, d: Waypoint, step=1.0,
                 hazards: List[HazardCircle]=[],
                 penalty_nm: float = 200.0,
                 max_nodes: int = 200000,
                 piracy_weight: float = 0.0) -> Tuple[List[Tuple[float,float]], float, int, bool]:
    """A* on a lat/lon grid. Edge cost = distance (nm) + penalties."""
    def snap(x, s):
        return round(x / s) * s

    start = (snap(o.lat, step), snap(o.lon, step))
    goal  = (snap(d.lat, step), snap(d.lon, step))

    dirs = [(0, step), (0, -step), (step, 0), (-step, 0), (step, step), (step, -step), (-step, step), (-step, -step)]
    def h(n):
        return haversine_km(n[0], n[1], goal[0], goal[1]) * KM_TO_NM

    openq = []
    heappush(openq, (0 + h(start), 0.0, start, None))
    came: Dict[Tuple[float,float], Optional[Tuple[float,float]]] = {}
    bestg: Dict[Tuple[float,float], float] = {start: 0.0}
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
            if nb[0] < -89.5 or nb[0] > 89.5:
                continue
            lon = nb[1]
            if lon < -180: lon += 360
            if lon >  180: lon -= 360
            nb = (nb[0], lon)

            seg_nm = haversine_km(cur[0], cur[1], nb[0], nb[1]) * KM_TO_NM

            # penalties
            p_demo = penalty_nm if inside_hazard(nb[0], nb[1], hazards) else 0.0
            p_piracy = piracy_penalty_nm(nb[0], nb[1], piracy_weight)

            cost = seg_nm + p_demo + p_piracy
            ng = g + cost
            if nb not in bestg or ng < bestg[nb]:
                bestg[nb] = ng
                heappush(openq, (ng + h(nb), ng, nb, cur))

    # reconstruct
    if goal not in came:
        pts = interpolate_geodesic(o.lat, o.lon, d.lat, d.lon, n=128)
        dist_nm = haversine_km(o.lat, o.lon, d.lat, d.lon) * KM_TO_NM
        return pts, dist_nm, visited, False

    path = []
    cur = goal
    while cur is not None:
        path.append(cur)
        cur = came[cur]
    path.reverse()

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
        },
    }
    return {"type": "FeatureCollection", "features": [feature]}
