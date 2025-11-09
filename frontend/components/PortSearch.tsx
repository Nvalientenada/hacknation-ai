'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, Point } from 'geojson';

type PortsFC = FeatureCollection<Point, { name: string }>;

export default function PortSearch({
  ports,
  onPick,
  placeholder = 'Search port…',
  className = '',
}: {
  ports: PortsFC | null;
  onPick: (p: { name: string; lat: number; lon: number }) => void;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Filter ports by query (simple case-insensitive substring match)
  const results = useMemo(() => {
    if (!ports || !q.trim()) return [];
    const s = q.trim().toLowerCase();
    // limit to 10 for performance/UX
    return ports.features
      .filter(f => f.properties?.name?.toLowerCase().includes(s))
      .slice(0, 10)
      .map(f => ({
        name: f.properties?.name ?? 'Unknown port',
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      }));
  }, [ports, q]);

  // Close when clicking outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const choose = (idx: number) => {
    const item = results[idx];
    if (!item) return;
    setQ(item.name);
    setOpen(false);
    onPick(item);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!results.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => q && setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="input w-full"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="port-listbox"
        role="combobox"
      />

      {open && results.length > 0 && (
        <ul
          id="port-listbox"
          role="listbox"
          className="
            absolute left-0 right-0 mt-2 z-50
            max-h-72 overflow-auto
            rounded-xl
            bg-neutral-900 text-white
            border border-white/10
            shadow-2xl
          "
        >
          {results.map((r, idx) => (
            <li
              key={`${r.name}-${idx}`}
              role="option"
              aria-selected={active === idx}
              onMouseDown={(e) => e.preventDefault()}   // keep input focused
              onClick={() => choose(idx)}
              onMouseEnter={() => setActive(idx)}
              className={`
                px-3 py-2 cursor-pointer transition-colors
                ${active === idx
                  ? 'bg-emerald-600 text-white'
                  : 'bg-neutral-800 hover:bg-neutral-700'}
                border-b border-white/5 last:border-none
              `}
            >
              <div className="font-medium truncate">{r.name}</div>
              <div className={`text-xs ${active === idx ? 'text-white/90' : 'text-white/70'}`}>
                {r.lat.toFixed(2)}, {r.lon.toFixed(2)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* No results panel */}
      {open && q.trim() && results.length === 0 && (
        <div
          className="
            absolute left-0 right-0 mt-2 z-50
            rounded-xl
            bg-neutral-900 text-white
            border border-white/10
            shadow-2xl
            px-3 py-2 text-sm
          "
        >
          No matching ports.
        </div>
      )}
    </div>
  );
}
