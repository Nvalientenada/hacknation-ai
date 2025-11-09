'use client';

import { useMemo, useRef, useState } from 'react';
import Map, { Source, Layer, Marker, type LayerProps, MapRef } from 'react-map-gl';
import type { FeatureCollection, LineString } from 'geojson';
import Spinner from '@/components/Spinner';
import Toast from '@/components/Toast';
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

export default function MapPage() {
  const [form, setForm] = useState<FormState>({
    originLat: 37.7749,
    originLon: -122.4194,
    destLat: 34.0522,
    destLon: -118.2437,
    speedKts: 14,
  });

  const [route, setRoute] = useState<FeatureCollection<LineString> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mapRef = useRef<MapRef | null>(null);
  const asNum = (v: string | number) => Number(v);
  const validLat = (v: number) => v >= -90 && v <= 90;
  const validLon = (v: number) => v >= -180 && v <= 180;

  const distanceNm = useMemo(() => {
    if (!route) return null;
    const nm = route.features?.[0]?.properties?.['distance_nm'];
    return typeof nm === 'number' ? nm : null;
  }, [route]);

  const etaHours = useMemo(() => {
    const speed = asNum(form.speedKts);
    if (!distanceNm || !speed || speed <= 0) return null;
    return distanceNm / speed;
  }, [distanceNm, form.speedKts]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') plan(); // press Enter to plan
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
    { label: 'NYC → Lisbon', o: [40.7128, -74.0060], d: [38.7223, -9.1393] },
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

  // Compute a bbox and fit the map to the route
  const fitToRoute = (fc: FeatureCollection<LineString>) => {
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
      const res = await fetch(`${API_BASE}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: oLat, lon: oLon },
          destination: { lat: dLat, lon: dLon },
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: FeatureCollection<LineString> = await res.json();
      setRoute(data);
      fitToRoute(data);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to plan');
      setRoute(null);
    } finally {
      setLoading(false);
    }
  };

  const routeLayer: LayerProps = {
    id: 'route',
    type: 'line',
    paint: {
      'line-color': '#22c55e',
      'line-width': 4,
      'line-opacity': 0.95,
    },
  };

  const glowLayer: LayerProps = {
    id: 'route-glow',
    type: 'line',
    paint: {
      'line-color': '#22c55e',
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
        <Link href="/" className="btn btn-ghost">Home</Link>
      </div>

      {/* Map container */}
      <div className="relative h-[calc(100vh-64px)]">
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
        </Map>

        {/* Floating control panel */}
        <div className="absolute top-6 left-6 w-[min(440px,calc(100%-2rem))] glass p-4 shadow-xl space-y-3 fade-up">
          <div className="flex items-center justify-between">
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

          <div className="flex items-center gap-2">
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

          {/* Presets */}
          <div className="flex items-center gap-2 flex-wrap">
            {presets.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p)} className="btn btn-ghost text-xs px-2 py-1">
                {p.label}
              </button>
            ))}
          </div>

          {/* Stats */}
          <div className="text-sm text-white/80">
            <div>Distance: {distanceNm ? `${distanceNm.toFixed(1)} nm` : '—'}</div>
            <div>ETA: {etaHours ? `${etaHours.toFixed(1)} h @ ${asNum(form.speedKts)} kts` : '—'}</div>
          </div>
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-black/20 backdrop-blur-[1px]">
            <div className="glass px-4 py-3 flex items-center gap-3">
              <Spinner />
              <span>Computing great-circle…</span>
            </div>
          </div>
        )}
      </div>

      {/* Toast for errors */}
      {err && <Toast message={err} onClose={() => setErr(null)} />}
    </div>
  );
}
