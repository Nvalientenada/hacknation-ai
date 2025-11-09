import csv
import io
import json
import os
import time
from datetime import datetime, timezone
from typing import Dict, List, Tuple, Any
from urllib.parse import urlparse

import requests
from google.cloud import storage

# ---------- Config via ENV ----------
BUCKET = os.getenv("BUCKET", "hacknation-piracy-nada")
OBJECT_NAME = os.getenv("OBJECT_NAME", "piracy.geojson")
# Comma-separated list of URLs. Each may be:
#  - a GeoJSON FeatureCollection (application/json)
#  - a CSV (text/csv) with columns: lat, lon, date(ISO or yyyy-mm-dd), description, source(optional), risk(optional)
SOURCES = [u.strip() for u in os.getenv("PIRACY_SOURCES", "").split(",") if u.strip()]

# Fallback sample (you can remove once you set PIRACY_SOURCES)
FALLBACK = [{
    "type": "Feature",
    "properties": {"source": "fallback", "desc": "Demo point", "date": "2024-01-01"},
    "geometry": {"type": "Point", "coordinates": [2.5, 4.5]},
}]

# ---------- Helpers ----------
def fetch_url(url: str) -> Tuple[str, bytes]:
    """Return (content_type, content) for a URL, raising on non-200."""
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
    return ctype, r.content

def parse_geojson(blob: bytes) -> List[Dict[str, Any]]:
    data = json.loads(blob.decode("utf-8"))
    if data.get("type") == "FeatureCollection" and isinstance(data.get("features"), list):
        return data["features"]
    raise ValueError("JSON is not a FeatureCollection")

def safe_float(v: Any) -> float:
    try:
        return float(v)
    except Exception:
        return float("nan")

def parse_csv(blob: bytes) -> List[Dict[str, Any]]:
    text = blob.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    feats: List[Dict[str, Any]] = []
    for row in reader:
        lat = safe_float(row.get("lat"))
        lon = safe_float(row.get("lon"))
        if not (lat == lat and lon == lon):  # check not NaN
            continue
        desc = row.get("description") or row.get("desc") or ""
        src = row.get("source") or infer_source_from_row(row)
        date_s = row.get("date") or ""
        # risk may be numeric or categorical
        risk = row.get("risk")
        props: Dict[str, Any] = {"desc": desc, "source": src}
        if date_s:
            props["date"] = date_s
        if risk:
            props["risk"] = risk
        feats.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
        })
    return feats

def infer_source_from_row(row: Dict[str, Any]) -> str:
    # Tweak as you wish (e.g., header names)
    if "mdatgog" in " ".join(row.keys()).lower():
        return "MDAT-GoG"
    if "recap" in " ".join(row.keys()).lower():
        return "ReCAAP"
    return "sheet"

def normalize_features(fs: List[Dict[str, Any]], default_source: str) -> List[Dict[str, Any]]:
    """Ensure minimum props and clean coords; drop any invalid features."""
    out: List[Dict[str, Any]] = []
    for f in fs:
        try:
            geom = f.get("geometry") or {}
            if geom.get("type") != "Point":
                # You can expand to Polygons later; for now keep points.
                continue
            coords = geom.get("coordinates") or []
            if not (isinstance(coords, list) and len(coords) == 2):
                continue
            lon, lat = coords
            lon = float(lon)
            lat = float(lat)
            props = dict(f.get("properties") or {})
            if "source" not in props:
                props["source"] = default_source
            # Normalize date to ISO if possible
            d = props.get("date")
            if d:
                try:
                    # Try parse a few common formats; fallback to original
                    dt = datetime.fromisoformat(str(d).replace("Z", "+00:00"))
                    props["date"] = dt.date().isoformat()
                except Exception:
                    props["date"] = str(d)
            out.append({
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            })
        except Exception:
            continue
    return out

def dedupe(features: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Simple de-duplication by (rounded) lat/lon + date."""
    seen = set()
    uniq: List[Dict[str, Any]] = []
    for f in features:
        coords = (f.get("geometry") or {}).get("coordinates") or []
        props = f.get("properties") or {}
        if not (isinstance(coords, list) and len(coords) == 2):
            continue
        lon, lat = coords
        # round to ~0.05° to cluster near-duplicates
        key = (round(lat, 2), round(lon, 2), props.get("date", ""))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(f)
    return uniq

def to_feature_collection(features: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": features,
    }

def write_to_gcs(bucket: str, object_name: str, data: Dict[str, Any]) -> None:
    client = storage.Client()
    b = client.bucket(bucket)
    blob = b.blob(object_name)
    # short cache so Frontend reloads often
    blob.cache_control = "public, max-age=60, must-revalidate"
    blob.content_type = "application/geo+json"
    blob.upload_from_string(json.dumps(data), content_type=blob.content_type)
    # optional: make public if bucket is public-read
    # blob.make_public()

# ---------- Entrypoint (HTTP) ----------
def update_piracy_feed(request):
    """
    2nd gen Cloud Function HTTP handler.
    Env:
      - BUCKET
      - OBJECT_NAME
      - PIRACY_SOURCES = "https://...,(another URL)"
    """
    start = time.time()
    all_features: List[Dict[str, Any]] = []

    sources = SOURCES if SOURCES else []
    if not sources:
        # No sources configured → keep fallback to avoid empty outputs
        all_features.extend(FALLBACK)

    for url in sources:
        try:
            ctype, content = fetch_url(url)
            default_src = urlparse(url).netloc or "feed"
            if "json" in ctype:
                feats = parse_geojson(content)
                feats = normalize_features(feats, default_src)
            elif "csv" in ctype or url.lower().endswith(".csv"):
                feats = parse_csv(content)
                feats = normalize_features(feats, default_src)
            else:
                # last resort: try JSON anyway
                try:
                    feats = parse_geojson(content)
                    feats = normalize_features(feats, default_src)
                except Exception:
                    feats = []
            all_features.extend(feats)
        except Exception as e:
            # swallow to keep pipeline resilient; you can log e
            continue

    cleaned = dedupe(all_features)
    fc = to_feature_collection(cleaned)

    # write to GCS
    write_to_gcs(BUCKET, OBJECT_NAME, fc)

    dur = round(time.time() - start, 2)
    return (f"ok: {len(cleaned)} features → gs://{BUCKET}/{OBJECT_NAME} in {dur}s\n", 200)
