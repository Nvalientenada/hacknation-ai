'use client';

import { useState } from 'react';
import Map, { Source, Layer, Marker, type LayerProps } from 'react-map-gl';
import type { FeatureCollection, LineString } from 'geojson';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE!;

export default function MapPage() {
  const [form, setForm] = useState({
    originLat: 37.7749,
    originLon: -122.4194,
    destLat: 34.0522,
    destLon: -118.2437,
  });

  const [route, setRoute] = useState<FeatureCollection<LineString> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const plan = async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: Number(form.originLat), lon: Number(form.originLon) },
          destination: { lat: Number(form.destLat), lon: Number(form.destLon) },
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: FeatureCollection<LineString> = await res.json();
      setRoute(data);
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
    paint: { 'line-color': '#22c55e', 'line-width': 4 },
  };

  const centerLng = (Number(form.originLon) + Number(form.destLon)) / 2;
  const centerLat = (Number(form.originLat) + Number(form.destLat)) / 2;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Route Planner</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input className="border px-2 py-1 rounded" name="originLat" value={form.originLat} onChange={onChange} />
        <input className="border px-2 py-1 rounded" name="originLon" value={form.originLon} onChange={onChange} />
        <input className="border px-2 py-1 rounded" name="destLat" value={form.destLat} onChange={onChange} />
        <input className="border px-2 py-1 rounded" name="destLon" value={form.destLon} onChange={onChange} />
      </div>

      <button onClick={plan} className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded">
        {loading ? 'Planning…' : 'Plan route'}
      </button>

      {err && <p className="text-red-400">{err}</p>}

      <div style={{ height: '70vh', width: '100%' }}>
        <Map
          initialViewState={{ longitude: centerLng, latitude: centerLat, zoom: 4 }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
        >
          <Marker longitude={Number(form.originLon)} latitude={Number(form.originLat)} />
          <Marker longitude={Number(form.destLon)} latitude={Number(form.destLat)} />

          {route && (
            <Source id="route" type="geojson" data={route}>
              <Layer {...routeLayer} />
            </Source>
          )}
        </Map>
      </div>
    </div>
  );
}
