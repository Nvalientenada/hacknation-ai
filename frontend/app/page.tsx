'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

type HealthState = 'idle' | 'checking' | 'ok' | 'down';

export default function HomePage() {
  const [health, setHealth] = useState<HealthState>('checking');

  const checkHealth = async () => {
    if (!API_BASE) {
      setHealth('down');
      return;
    }
    try {
      setHealth('checking');
      const r = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      setHealth(r.ok && j?.ok ? 'ok' : 'down');
    } catch {
      setHealth('down');
    }
  };

  useEffect(() => {
    void checkHealth();
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* --- Subtle gradient field --- */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-[36rem] w-[36rem] rounded-full bg-gradient-to-tr from-emerald-500/20 to-sky-500/20 blur-3xl animate-pulse" />
        <div className="absolute -bottom-32 -right-24 h-[36rem] w-[36rem] rounded-full bg-gradient-to-tr from-fuchsia-500/20 to-indigo-500/20 blur-3xl animate-pulse" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            background:
              'radial-gradient(1000px 600px at 50% -10%, rgba(56,189,248,0.25), transparent 60%), radial-gradient(800px 500px at 90% 110%, rgba(99,102,241,0.25), transparent 60%)',
          }}
        />
        {/* faint grid */}
        <svg className="absolute inset-0 h-full w-full opacity-[0.06]" aria-hidden>
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" fill="none" stroke="currentColor" strokeWidth="0.75" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" className="text-slate-200" />
        </svg>
      </div>

      {/* --- Hero --- */}
      <section className="relative mx-auto flex max-w-6xl flex-col items-center px-6 pt-28 pb-16 sm:pt-36 sm:pb-24 text-center">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-7xl">
          <span className="bg-gradient-to-r from-white via-emerald-200 to-sky-200 bg-clip-text text-transparent">
            AI Captain
          </span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-300">
          Plan globe-aware sea routes with a modern, map-first interface. Great-circle math,
          hazard avoidance, and live overlays — powered by a FastAPI backend on Cloud Run.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/map"
            className="group inline-flex items-center gap-2 rounded-2xl bg-emerald-500/90 px-5 py-3 font-semibold text-slate-900 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-300 transition hover:-translate-y-0.5 hover:bg-emerald-400"
          >
            Open Map Planner 🌍
            <span className="transition group-hover:translate-x-0.5">→</span>
          </Link>

          <button
            onClick={checkHealth}
            className="inline-flex items-center gap-2 rounded-2xl bg-white/5 px-5 py-3 font-medium text-slate-100 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            API Health
            <StatusDot state={health} />
          </button>
        </div>

        {/* Tech badges */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400">
          <Badge>Great-circle routing</Badge>
          <Badge>ETA &amp; Distance</Badge>
          <Badge>Mapbox GL</Badge>
          <Badge>FastAPI + Cloud Run</Badge>
        </div>
      </section>

      {/* --- Features grid --- */}
      <section className="relative mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 px-6 pb-20 sm:grid-cols-3">
        <FeatureCard
          emoji="🧭"
          title="Smart routing"
          desc="Great-circle paths out of the box, with optional A* hazard avoidance and shareable routes."
        />
        <FeatureCard
          emoji="🌊"
          title="Live overlays"
          desc="Plug in piracy feeds, storms, ports, and bathymetry layers. Toggle and weight them instantly."
        />
        <FeatureCard
          emoji="⚡"
          title="Cloud native"
          desc="FastAPI backend with CORS, deployable to Cloud Run. Works locally and scales globally."
        />
      </section>

      {/* --- Footer --- */}
      <footer className="relative mx-auto max-w-6xl px-6 pb-12 text-center text-xs text-slate-500">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
          <span>© {new Date().getFullYear()} AI Captain</span>
          <span className="opacity-50">·</span>
          <span>Built for exploration.</span>
        </div>
      </footer>
    </main>
  );
}

/* ---------------- Components ---------------- */

function StatusDot({ state }: { state: 'idle' | 'checking' | 'ok' | 'down' }) {
  const label =
    state === 'checking' ? 'Checking…' : state === 'ok' ? 'Healthy' : state === 'down' ? 'Down' : '—';
  const color =
    state === 'ok'
      ? 'bg-emerald-400 ring-emerald-300'
      : state === 'checking'
      ? 'bg-yellow-400 ring-yellow-300'
      : 'bg-rose-400 ring-rose-300';
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ring-2 ${color} animate-[pulse_1.8s_ease-in-out_infinite]`} />
      <span className="text-slate-300">{label}</span>
    </span>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
      {children}
    </span>
  );
}

function FeatureCard({
  emoji,
  title,
  desc,
}: {
  emoji: string;
  title: string;
  desc: string;
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-5 transition
                 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10"
      style={{ transformStyle: 'preserve-3d' }}
    >
      {/* glow */}
      <div className="pointer-events-none absolute -inset-1 opacity-0 blur-2xl transition group-hover:opacity-20"
           style={{ background: 'radial-gradient(600px 200px at 0% 0%, rgba(16,185,129,0.6), transparent 60%)' }} />
      <div className="flex items-start gap-3">
        <div className="text-2xl">{emoji}</div>
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{desc}</p>
        </div>
      </div>
      <div className="mt-4 h-px bg-gradient-to-r from-white/10 to-transparent" />
      <div className="mt-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          Learn more
          <span className="transition group-hover:translate-x-0.5">→</span>
        </span>
      </div>
    </div>
  );
}
