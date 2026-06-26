import { createHealthResponse } from "@sparkle/shared/utils";

export default function App() {
  const health = createHealthResponse("web");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 text-slate-900">
      <h1 className="text-3xl font-bold">Sparkle Web</h1>
      <p className="text-slate-500">
        {health.service} · {health.status}
      </p>
    </main>
  );
}
