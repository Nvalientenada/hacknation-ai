'use client';

import { useEffect, useMemo, useState } from 'react';

type Props = {
  label: string;
  token: string;
  onPick: (lat: number, lon: number, label: string) => void;
};

type Feature = {
  id: string;
  place_name: string;
  center: [number, number]; // [lon, lat]
};

type GeocodeResp = {
  features: Feature[];
};

export default function CitySearch({ label, token, onPick }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(false);

  // light debounce
  useEffect(() => {
    const v = q.trim();
    if (!v) {
      setItems([]);
      setOpen(false);
      return;
    }
    const id = setTimeout(async () => {
      try {
        setLoading(true);
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          v,
        )}.json?types=place%2Clocality%2Cregion&limit=6&access_token=${token}`;
        const res = await fetch(url);
        const data: GeocodeResp = await res.json();
        setItems(data.features ?? []);
        setOpen(true);
      } catch {
        setItems([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [q, token]);

  const list = useMemo(() => items.slice(0, 6), [items]);

  return (
    <div className="relative">
      <label className="block text-xs mb-1 text-white/70">{label}</label>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="input w-full"
        placeholder="Type a city (e.g. Lisbon, Tokyo, New York)…"
      />
      {open && (
        <div className="absolute z-[60] mt-1 w-full">
          <div className="rounded-xl border border-white/15 bg-zinc-900/95 backdrop-blur-xl shadow-2xl">
            {loading && (
              <div className="px-3 py-2 text-xs text-white/70">Searching…</div>
            )}
            {!loading &&
              list.map((f) => (
                <button
                  key={f.id}
                  className="w-full text-left px-3 py-2 hover:bg-white/10 focus:bg-white/10 transition rounded-lg"
                  onMouseDown={() => {
                    const [lon, lat] = f.center;
                    onPick(lat, lon, f.place_name);
                    setQ(f.place_name);
                    setOpen(false);
                  }}
                >
                  <div className="text-sm">{f.place_name}</div>
                  <div className="text-xs text-white/50">
                    ({f.center[1].toFixed(4)}, {f.center[0].toFixed(4)})
                  </div>
                </button>
              ))}
            {!loading && !list.length && (
              <div className="px-3 py-2 text-xs text-white/50">No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
