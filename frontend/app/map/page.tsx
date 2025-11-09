'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Map, {
  Source,
  Layer,
  Marker,
  type LayerProps,
  type MapRef,
} from 'react-map-gl';
import type {
  FeatureCollection as GeoJSONFC,
  LineString,
  Point,
  Polygon,
  Position,
} from 'geojson';
import Spinner from '@/components/Spinner';
import Toast from '@/components/Toast';
import LayerToggles from '@/components/LayerToggles';
import Link from 'next/link';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE!;

type FormState = {
  originLat: string | number;
  originLon: string | number;
  destLat: string | number;
  destLon: string | number;
  speedKts: string | number;
};

type PortsFC = GeoJSONFC<Point, { name: string }>;
type PiracyFC = GeoJSONFC<Polygon | Point, { risk?: string }>;

type PlanPayload = {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
};

type AvoidPayload = PlanPayload & {
  hazards: { lat: number; lon: number; radius_nm: number }[];
  grid_step_deg: number;
  penalty_nm: number;
  max_nodes: number;
  piracy_weight: number;
  storm_weight: number;
  depth_penalty_nm: number;
};

export default function MapPage() {
  const [form, setForm] = useState<FormState>({
    originLat: 37.7749,
    originLon: -122.4194,
    destLat: 34.0522,
    destLon: -118.2437,
    speedKts: 14,
  });

  const [route, setRoute] = useState<GeoJSONFC<LineString> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Share / feedback
  const [shareBusy, setShareBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Overlay toggles + data
  const [layers, setLayers] = useState({
    ports: true,
    piracy: true,
    bathy: true,
    weather: false,
  });
  const [ports, setPorts] = useState<PortsFC | null>(null);
  const [piracy, setPiracy] = useState<PiracyFC | null>(null);

  // Hazard-avoid (A*) demo + weights
  const [avoidOn, setAvoidOn] = useState(false);
  const [hazardPoly, setHazardPoly] = useState<GeoJSONFC<Polygon> | null>(null);
  const HAZARD_RADIUS_NM = 200;

  const [piracyWeight, setPiracyWeight] = useState(0.8); // 0..1
  const [stormWeight, setStormWeight] = useState(0.0);   // 0..1
  const [depthPenalty, setDepthPenalty] = useState(0.0); // absolute nm (demo)

  const mapRef = useRef<MapRef | null>(null);

  // --- helpers
  const asNum = (v: string | number) => Number(v);
  const validLat = (v: number) => v >= -90 && v <= 90;
  const validLon = (v: number) => v >= -180 && v <= 180;

  const distanceNm = useMemo(() => {
    if (!route) return null;
    const nm = route.features?.[0]?.properties?.['distance_nm'];
    return typeof nm === 'number' ? nm : null;
  }, [route]);

  const algo = useMemo(() => {
    if (!route) return null;
    const a = route.features?.[0]?.properties?.['algo'];
    return typeof a === 'string' ? a : null;
  }, [route]);

  const etaHours = useMemo(() => {
    const speed = asNum(form.speedKts);
    if (!distanceNm || !speed || speed <= 0) return null;
    return distanceNm / speed;
  }, [distanceNm, form.speedKts]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') plan();
  };

  const swap = () => {
    setForm((f) => ({
      ...f,
      originLat: f.destLat,
      originLon: f.destLon,
      destLat: f.originLat,
      destLon: f.originLon,
    }));
    setRoute(null);
  };

  const presets: Array<{ label: string; o: [number, number]; d: [number, number] }> = [
    { label: 'SF → LA', o: [37.7749, -122.4194], d: [34.0522, -118.2437] },
    { label: 'NYC → Lisbon', o: [40.7128, -74.006], d: [38.7223, -9.1393] },
    { label: 'Tokyo → Seattle', o: [35.6762, 139.6503], d: [47.6062, -122.3321] },
  ];

  const applyPreset = (p: (typeof presets)[number]) => {
    setForm((f) => ({
      ...f,
      originLat: p.o[0],
      originLon: p.o[1],
      destLat: p.d[0],
      destLon: p.d[1],
    }));
    setRoute(null);
  };

  // --- fit the map to a route bbox
  const fitToRoute = (fc: GeoJSONFC<LineString>) => {
    const coords = fc.features?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 2 || !mapRef.current) return;

    let minLon = coords[0][0], maxLon = coords[0][0];
    let minLat = coords[0][1], maxLat = coords[0][1];
    for (const [lon, lat] of coords) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    mapRef.current.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 80, duration: 1200 }
    );
  };

  // --- Build a shareable URL from current form
  const makeShareUrl = () => {
    const params = new URLSearchParams({
      oLat: String(form.originLat),
      oLon: String(form.originLon),
      dLat: String(form.destLat),
      dLon: String(form.destLon),
      spd: String(form.speedKts),
      pw: String(piracyWeight),
      sw: String(stormWeight),
      dp: String(depthPenalty),
      avoid: String(avoidOn ? 1 : 0),
    });
    return `${window.location.origin}/map?${params.toString()}`;
  };

  // --- Share handler (Web Share → clipboard → textarea fallback)
  const shareLink = async () => {
    try {
      setShareBusy(true);
      const url = makeShareUrl();

      if (navigator.share) {
        await navigator.share({ title: 'AI Captain — Route', url });
        return;
      }

      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        setToast('Link copied to clipboard');
        return;
      }

      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setToast('Link copied to clipboard');
    } catch {
      setToast('Share canceled or failed');
    } finally {
      setShareBusy(false);
    }
  };

  // --- small geodesic helpers for hazard circle ---
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const NM_TO_M = 1852;
  const R = 6371000; // meters

  // destination point given start lat/lon (deg), bearing (deg), distance (nm)
  const destination = (lat: number, lon: number, brgDeg: number, distNm: number) => {
    const brg = toRad(brgDeg);
    const d = (distNm * NM_TO_M) / R;
    const φ1 = toRad(lat);
    const λ1 = toRad(lon);
    const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
    const sinD = Math.sin(d), cosD = Math.cos(d);

    const sinφ2 = sinφ1 * cosD + cosφ1 * sinD * Math.cos(brg);
    const φ2 = Math.asin(sinφ2);
    const y = Math.sin(brg) * sinD * cosφ1;
    const x = cosD - sinφ1 * sinφ2;
    const λ2 = λ1 + Math.atan2(y, x);

    return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 }; // normalize lon
  };

  const makeHazardPolygon = (lat: number, lon: number, radiusNm: number, steps = 128) => {
    const coords: Position[] = [];
    for (let i = 0; i <= steps; i++) {
      const bearing = (i / steps) * 360;
      const p = destination(lat, lon, bearing, radiusNm);
      coords.push([p.lon, p.lat]);
    }
    const fc: GeoJSONFC<Polygon> = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { radius_nm: radiusNm },
          geometry: { type: 'Polygon', coordinates: [coords] },
        },
      ],
    };
    return fc;
  };

  // --- Plan route (great-circle or A* avoid)
  const plan = async () => {
    setErr(null);

    const oLat = asNum(form.originLat);
    const oLon = asNum(form.originLon);
    const dLat = asNum(form.destLat);
    const dLon = asNum(form.destLon);

    if (![oLat, dLat].every(validLat) || ![oLon, dLon].every(validLon)) {
      setErr('Please enter valid coordinates: lat ∈ [-90,90], lon ∈ [-180,180].');
      return;
    }

    setLoading(true);
    try {
      let url = `${API_BASE}/plan`;
      let body: PlanPayload | AvoidPayload = {
        origin: { lat: oLat, lon: oLon },
        destination: { lat: dLat, lon: dLon },
      };

      if (avoidOn) {
        // Build a hazard circle centered at the midpoint
        const midLat = (oLat + dLat) / 2;
        const midLon = (oLon + dLon) / 2;
        setHazardPoly(makeHazardPolygon(midLat, midLon, HAZARD_RADIUS_NM));
        url = `${API_BASE}/plan_avoid`;
        body = {
          origin: { lat: oLat, lon: oLon },
          destination: { lat: dLat, lon: dLon },
          hazards: [{ lat: midLat, lon: midLon, radius_nm: HAZARD_RADIUS_NM }],
          grid_step_deg: 1.0,
          penalty_nm: 400.0,
          max_nodes: 200000,
          piracy_weight: Number(piracyWeight),
          storm_weight: Number(stormWeight),
          depth_penalty_nm: Number(depthPenalty),
        };
      } else {
        setHazardPoly(null);
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: GeoJSONFC<LineString> = await res.json();
      setRoute(data);
      fitToRoute(data);

      // update address bar so the current URL is shareable
      try {
        const params = new URLSearchParams({
          oLat: String(form.originLat),
          oLon: String(form.originLon),
          dLat: String(form.destLat),
          dLon: String(form.destLon),
          spd: String(form.speedKts),
          pw: String(piracyWeight),
          sw: String(stormWeight),
          dp: String(depthPenalty),
          avoid: String(avoidOn ? 1 : 0),
        });
        const newUrl = `/map?${params.toString()}`;
        window.history.replaceState(null, '', newUrl);
      } catch {}
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to plan');
      setRoute(null);
    } finally {
      setLoading(false);
    }
  };

  // --- Preload from query (?oLat=..&...&avoid=1&pw=..&sw=..&dp=..)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const qs = new URLSearchParams(window.location.search);
    const oLat = qs.get('oLat'), oLon = qs.get('oLon');
    const dLat = qs.get('dLat'), dLon = qs.get('dLon');
    const spd  = qs.get('spd');
    const avoid = qs.get('avoid');
    const pw = qs.get('pw'), sw = qs.get('sw'), dp = qs.get('dp');

    setAvoidOn(avoid === '1');
    if (pw) setPiracyWeight(Number(pw));
    if (sw) setStormWeight(Number(sw));
    if (dp) setDepthPenalty(Number(dp));

    if (oLat && oLon && dLat && dLon) {
      setForm((f) => ({
        ...f,
        originLat: Number(oLat),
        originLon: Number(oLon),
        destLat: Number(dLat),
        destLon: Number(dLon),
        speedKts: spd ? Number(spd) : f.speedKts,
      }));
      setTimeout(() => { void plan(); }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  // --- Fetch small demo layers from /public
  useEffect(() => {
    void (async () => {
      try {
        const p: PortsFC = await fetch('/data/ports-sample.geojson').then((r) => r.json());
        setPorts(p);
      } catch {}
      try {
        const pr: PiracyFC = await fetch('/data/piracy-sample.geojson').then((r) => r.json());
        setPiracy(pr);
      } catch {}
    })();
  }, []);

  // --- layers
  const routeLayer: LayerProps = {
    id: 'route',
    type: 'line',
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'algo'], 'astar'],
        '#38bdf8', // cyan if avoided
        '#22c55e', // green otherwise
      ],
      'line-width': 4,
      'line-opacity': 0.95,
    },
  };

  const glowLayer: LayerProps = {
    id: 'route-glow',
    type: 'line',
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'algo'], 'astar'],
        '#38bdf8',
        '#22c55e',
      ],
      'line-width': 10,
      'line-opacity': 0.18,
      'line-blur': 1.5,
    },
  };

  const centerLng = (asNum(form.originLon) + asNum(form.destLon)) / 2;
  const centerLat = (asNum(form.originLat) + asNum(form.destLat)) / 2;

  return (
    <div className="min-h-screen text-white">
      {/* Top bar */}
      <div className="px-6 py-4 flex items-center justify-between fade-up">
        <h1 className="text-2xl font-bold">AI Captain — Route Planner</h1>
        <div className="flex items-center gap-2">
          <Link href="/" className="btn btn-ghost">Home</Link>
          <button onClick={shareLink} className="btn btn-ghost" disabled={shareBusy}>
            {shareBusy ? 'Sharing…' : 'Share 🔗'}
          </button>
          {route && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                const blob = new Blob([JSON.stringify(route, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'route.geojson';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download GeoJSON
            </button>
          )}
        </div>
      </div>

      {/* Map container */}
      <div className="relative h:[calc(100vh-64px)] h-[calc(100vh-64px)]">
        <Map
          ref={mapRef}
          initialViewState={{ longitude: centerLng, latitude: centerLat, zoom: 3 }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
        >
          {/* Markers */}
          <Marker longitude={asNum(form.originLon)} latitude={asNum(form.originLat)}>
            <div className="w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-emerald-300/60" />
          </Marker>
          <Marker longitude={asNum(form.destLon)} latitude={asNum(form.destLat)}>
            <div className="w-3 h-3 rounded-full bg-sky-400 ring-2 ring-sky-300/60" />
          </Marker>

          {/* Route with a subtle glow */}
          {route && (
            <Source id="route" type="geojson" data={route}>
              <Layer {...glowLayer} />
              <Layer {...routeLayer} />
            </Source>
          )}

          {/* Hazard polygon (if avoidance is on) */}
          {hazardPoly && (
            <Source id="hazard" type="geojson" data={hazardPoly}>
              <Layer
                id="hazard-fill"
                type="fill"
                paint={{ 'fill-color': '#f87171', 'fill-opacity': 0.15 }}
              />
              <Layer
                id="hazard-outline"
                type="line"
                paint={{ 'line-color': '#f87171', 'line-width': 2 }}
              />
            </Source>
          )}

          {/* Bathymetry raster (placeholder) */}
          {layers.bathy && (
            <Source
              id="bathy"
              type="raster"
              tiles={[
                // Demo tile for visual effect; replace with GEBCO later.
                'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              ]}
              tileSize={256}
            >
              <Layer id="bathy-layer" type="raster" paint={{ 'raster-opacity': 0.25 }} />
            </Source>
          )}

          {/* Weather tiles (placeholder) */}
          {layers.weather && (
            <Source
              id="weather"
              type="raster"
              tiles={[
                // Example placeholder; swap to NWS/StormGlass tile later.
                'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              ]}
              tileSize={256}
            >
              <Layer id="weather-layer" type="raster" paint={{ 'raster-opacity': 0.18 }} />
            </Source>
          )}

          {/* Ports (points) */}
          {layers.ports && ports && (
            <Source id="ports" type="geojson" data={ports}>
              <Layer
                id="ports-circle"
                type="circle"
                paint={{
                  'circle-radius': 4,
                  'circle-color': '#60a5fa',
                  'circle-stroke-color': '#1e3a8a',
                  'circle-stroke-width': 1.5,
                }}
              />
            </Source>
          )}

          {/* Piracy (polygons + points) */}
          {layers.piracy && piracy && (
            <Source id="piracy" type="geojson" data={piracy}>
              <Layer
                id="piracy-fill"
                type="fill"
                paint={{
                  'fill-color': '#ef4444',
                  'fill-opacity': 0.15,
                }}
                filter={['==', ['geometry-type'], 'Polygon']}
              />
              <Layer
                id="piracy-outline"
                type="line"
                paint={{
                  'line-color': '#ef4444',
                  'line-width': 2,
                  'line-opacity': 0.7,
                }}
                filter={['==', ['geometry-type'], 'Polygon']}
              />
              <Layer
                id="piracy-points"
                type="circle"
                paint={{
                  'circle-radius': 3.5,
                  'circle-color': '#ef4444',
                }}
                filter={['==', ['geometry-type'], 'Point']}
              />
            </Source>
          )}
        </Map>

        {/* Floating control panel */}
        <div className="absolute top-6 left-6 w-[min(560px,calc(100%-2rem))] glass p-4 shadow-xl space-y-3 fade-up">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Plan a route</h2>
            <button onClick={swap} className="btn btn-ghost">Swap ↕</button>
          </div>

          {/* Inputs */}
          <div className="grid grid-cols-2 gap-2">
            <input className="input" name="originLat" value={form.originLat} onChange={onChange} onKeyDown={onKeyDown} placeholder="Origin lat" />
            <input className="input" name="originLon" value={form.originLon} onChange={onChange} onKeyDown={onKeyDown} placeholder="Origin lon" />
            <input className="input" name="destLat"   value={form.destLat}   onChange={onChange} onKeyDown={onKeyDown} placeholder="Destination lat" />
            <input className="input" name="destLon"   value={form.destLon}   onChange={onChange} onKeyDown={onKeyDown} placeholder="Destination lon" />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input className="input w-32" name="speedKts" value={form.speedKts} onChange={onChange} onKeyDown={onKeyDown} placeholder="Speed (kts)" />
            <button onClick={plan} disabled={loading} className="btn btn-primary">
              {loading ? (<><Spinner /><span className="ml-2">Planning…</span></>) : 'Plan route'}
            </button>
            <button
              onClick={() => route && fitToRoute(route)}
              disabled={!route}
              className="btn btn-ghost"
              title="Fit to route"
            >
              Fit ↗
            </button>
          </div>

          {/* Weights */}
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs mb-1">Piracy weight ({piracyWeight.toFixed(2)})</label>
              <input type="range" min={0} max={1} step={0.1} value={piracyWeight} onChange={(e) => setPiracyWeight(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs mb-1">Storm weight ({stormWeight.toFixed(2)})</label>
              <input type="range" min={0} max={1} step={0.1} value={stormWeight} onChange={(e) => setStormWeight(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs mb-1">Depth penalty nm ({depthPenalty.toFixed(1)})</label>
              <input type="range" min={0} max={50} step={1} value={depthPenalty} onChange={(e) => setDepthPenalty(Number(e.target.value))} />
            </div>
          </div>

          {/* Presets */}
          <div className="flex items-center gap-2 flex-wrap">
            {presets.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p)} className="btn btn-ghost text-xs px-2 py-1">
                {p.label}
              </button>
            ))}
          </div>

          {/* Layer toggles */}
          <LayerToggles value={layers} onChange={setLayers} />

          {/* Avoidance toggle */}
          <div className="mt-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={avoidOn}
                onChange={() => setAvoidOn(v => !v)}
              />
              Avoid demo hazard (midpoint circle, {HAZARD_RADIUS_NM} nm)
            </label>
          </div>

          {/* Stats */}
          <div className="text-sm text-white/80 pt-2 border-t border-white/10 mt-2">
            <div>Distance: {distanceNm ? `${distanceNm.toFixed(1)} nm` : '—'}</div>
            <div>ETA: {etaHours ? `${etaHours.toFixed(1)} h @ ${asNum(form.speedKts)} kts` : '—'}</div>
            <div>Algo: {algo ?? '—'}</div>
            <div className="text-white/60">
              Weights → piracy: {piracyWeight.toFixed(2)}, storm: {stormWeight.toFixed(2)}, depth nm: {depthPenalty.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-black/20 backdrop-blur-[1px]">
            <div className="glass px-4 py-3 flex items-center gap-3">
              <Spinner />
              <span>Computing route…</span>
            </div>
          </div>
        )}
      </div>

      {/* Toasts */}
      {err && <Toast message={err} onClose={() => setErr(null)} />}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
