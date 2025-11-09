import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center text-white px-6">
      <h1 className="text-5xl font-extrabold tracking-tight">
        AI Captain
      </h1>
      <p className="mt-4 text-white/70 max-w-xl">
        Plan globe-aware sea routes with a modern, map-first interface. Powered by a FastAPI backend on Cloud Run.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <Link href="/map" className="btn btn-primary">
          Open Map Planner 🌊
        </Link>
        <a
          href="https://hacknation-ai.vercel.app/health"
          target="_blank"
          className="btn btn-ghost"
        >
          API Health
        </a>
      </div>

      <div className="mt-8 flex gap-3">
        <span className="badge">Great-circle routing</span>
        <span className="badge">ETA & Distance</span>
        <span className="badge">Mapbox GL</span>
      </div>
    </main>
  );
}
