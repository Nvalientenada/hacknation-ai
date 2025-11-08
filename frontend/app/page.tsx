'use client';
import { useEffect, useState } from 'react';

export default function Home() {
  const [ok, setOk] = useState<null | boolean>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_BASE}/health`)
      .then(r => r.json())
      .then(d => setOk(!!d.ok))
      .catch(() => setOk(false));
  }, []);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">AI Captain - HackNation</h1>
      <p className="mt-2">Backend health: {ok === null ? 'Loading...' : ok ? 'OK ✅' : 'DOWN ❌'}</p>
    </main>
  );
}
