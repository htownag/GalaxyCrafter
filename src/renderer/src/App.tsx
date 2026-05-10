import { useCallback, useEffect, useState } from "react";
import type { Resource, SnapshotSummary } from "@shared/ipc-types";
import { STAT_KEYS } from "@shared/ipc-types";

export function App(): JSX.Element {
  const [latest, setLatest] = useState<SnapshotSummary | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const snap = await window.api.getLatestSnapshot();
      setLatest(snap);
      if (snap) {
        const list = await window.api.listResources();
        setResources(list);
      } else {
        setResources([]);
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const result = await window.api.refreshSnapshot();
      console.log("[refresh]", result);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen p-6">
      <header className="flex items-center justify-between mb-6 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">GalaxyCrafter</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Phase 1 — Foundation. SR2 spawn ingest only; verdicts, inventory, simulator come next.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-400">
          {latest && (
            <span className="text-right leading-tight">
              <span className="block">{new Date(latest.fetchedAt).toLocaleString()}</span>
              <span className="block text-zinc-300">{latest.resourceCount} resources</span>
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium"
          >
            {busy ? "Refreshing…" : latest ? "Refresh Now" : "Pull SR2 snapshot"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-900 bg-red-950 text-red-200 text-sm">
          {error}
        </div>
      )}

      {resources.length === 0 && !busy && (
        <p className="text-zinc-500">
          No snapshot yet. Click <strong className="text-zinc-300">Pull SR2 snapshot</strong> to
          fetch the current spawn list from galaxyharvester.net.
        </p>
      )}

      {resources.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-300 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Group</th>
                <th className="px-3 py-2 text-left font-medium">Planets</th>
                {STAT_KEYS.map((s) => (
                  <th key={s} className="px-2 py-2 text-right font-medium">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.id} className="border-t border-zinc-800 hover:bg-zinc-900/50">
                  <td className="px-3 py-2 font-mono text-zinc-100">{r.name}</td>
                  <td className="px-3 py-2 text-zinc-200">{r.typeDisplayName}</td>
                  <td className="px-3 py-2 text-zinc-500 font-mono text-xs">{r.groupId}</td>
                  <td className="px-3 py-2 text-zinc-400 text-xs">{r.planets.join(", ")}</td>
                  {STAT_KEYS.map((s) => (
                    <td
                      key={s}
                      className="px-2 py-2 text-right text-zinc-300 tabular-nums"
                    >
                      {r.stats[s] ?? <span className="text-zinc-700">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
