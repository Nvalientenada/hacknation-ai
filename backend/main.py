from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://hacknation-ai.vercel.app",  # your production domain
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # allow all Vercel preview URLs like https://hacknation-ai-git-main-....vercel.app
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}


from pydantic import BaseModel
from typing import List, Optional
import math

# ---------- Models ----------
class Waypoint(BaseModel):
    lat: float
    lon: float

class PlanRequest(BaseModel):
    origin: Waypoint
    destination: Waypoint
    avoids: Optional[List[Waypoint]] = []  # reserved for future hazard avoidance

# ---------- Helpers ----------
R_EARTH_KM = 6371.0088
KM_TO_NM = 0.539957

def haversine_km(lat1, lon1, lat2, lon2):
    # all args in degrees
    φ1, λ1, φ2, λ2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dφ = φ2 - φ1
    dλ = λ2 - λ1
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R_EARTH_KM * c

def interpolate_geodesic(lat1, lon1, lat2, lon2, n=64):
    """
    Great-circle interpolation: returns [(lat,lon), ...] including endpoints.
    No deps, good enough for demo-scale routes.
    """
    φ1, λ1, φ2, λ2 = map(math.radians, [lat1, lon1, lat2, lon2])
    d = 2 * math.asin(math.sqrt(
        math.sin((φ2 - φ1)/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin((λ2 - λ1)/2)**2
    ))
    if d == 0:
        return [(lat1, lon1)]
    coords = []
    for i in range(n + 1):
        f = i / n
        A = math.sin((1 - f) * d) / math.sin(d)
        B = math.sin(f * d) / math.sin(d)
        x = A * math.cos(φ1) * math.cos(λ1) + B * math.cos(φ2) * math.cos(λ2)
        y = A * math.cos(φ1) * math.sin(λ1) + B * math.cos(φ2) * math.sin(λ2)
        z = A * math.sin(φ1) + B * math.sin(φ2)
        φ = math.atan2(z, math.sqrt(x * x + y * y))
        λ = math.atan2(y, x)
        coords.append((math.degrees(φ), math.degrees(λ)))
    return coords

# ---------- Endpoint ----------
@app.post("/plan")
def plan(req: PlanRequest):
    # compute path
    pts = interpolate_geodesic(
        req.origin.lat, req.origin.lon,
        req.destination.lat, req.destination.lon,
        n=64
    )    
    dist_km = haversine_km(req.origin.lat, req.origin.lon, req.destination.lat, req.destination.lon)
    dist_nm = dist_km * KM_TO_NM

    # Build GeoJSON FeatureCollection
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": [[lon, lat] for (lat, lon) in pts],  # GeoJSON = [lon,lat]
        },
        "properties": {
            "distance_nm": round(dist_nm, 2),
            "points": len(pts)
        },
    }
    return {"type": "FeatureCollection", "features": [feature]}
