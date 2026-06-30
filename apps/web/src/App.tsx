import { ClaudeCodeLoginPanel } from "@/components/ClaudeCodeLoginPanel";

export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 p-6 text-slate-900">
      <h1 className="text-3xl font-bold">Sparkle</h1>
      <ClaudeCodeLoginPanel />
    </main>
  );
}
