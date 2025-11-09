'use client';

import type { FeatureCollection, Point } from 'geojson';
import PortSearch from './PortSearch';

export type Waypoint = { lat: number | string; lon: number | string };

// Ports GeoJSON: Point features with a "name" property
type PortsFC = FeatureCollection<Point, { name: string }>;

export default function Waypoints({
  value,
  onChange,
  ports,
}: {
  value: Waypoint[];
  onChange: (wps: Waypoint[]) => void;
  ports: PortsFC | null;
}) {
  const add = () => onChange([...value, { lat: '', lon: '' }]);

  const update = (idx: number, patch: Partial<Waypoint>) => {
    const next = value.map((w, i) => (i === idx ? { ...w, ...patch } : w));
    onChange(next);
  };

  const remove = (idx: number) => {
    const next = value.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Waypoints</h3>
        <button className="btn btn-ghost" onClick={add}>+ Add waypoint</button>
      </div>

      {value.length === 0 && (
        <div className="text-sm text-white/60">
          No waypoints. Add ports to force the route through them.
        </div>
      )}

      {value.map((w, idx) => (
        <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center">
          {/* Port autocomplete */}
          <div className="sm:col-span-2">
            <PortSearch
              ports={ports}
              placeholder="Search port…"
              onPick={(p) => update(idx, { lat: p.lat, lon: p.lon })}
            />
          </div>

          {/* Lat/Lon manual entries */}
          <input
            className="input"
            placeholder="Lat"
            value={w.lat}
            onChange={(e) => update(idx, { lat: e.target.value })}
          />
          <input
            className="input"
            placeholder="Lon"
            value={w.lon}
            onChange={(e) => update(idx, { lon: e.target.value })}
          />
          <button className="btn btn-ghost" onClick={() => remove(idx)}>Remove</button>
        </div>
      ))}
    </div>
  );
}
