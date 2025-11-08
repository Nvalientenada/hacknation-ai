import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen text-center space-y-8 bg-black text-white">
      <h1 className="text-5xl font-bold">AI Captain - HackNation</h1>
      <p className="text-gray-400 max-w-xl">
        Plan optimal sea routes between ports using AI-powered navigation and
        real-time geospatial data.
      </p>

      <Link
        href="/map"
        className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-lg transition"
      >
        Open Map Planner 🌊
      </Link>
    </main>
  );
}
