import { useCallback, useEffect, useMemo, useState } from "react";
import type { Resource, SnapshotSummary, StatKey } from "@shared/ipc-types";
import { STAT_KEYS } from "@shared/ipc-types";

type SortKey = "name" | "type" | "group" | StatKey;
type SortDir = "asc" | "desc";

function relativeAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "in the future";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function App(): JSX.Element {
  const [latest, setLatest] = useState<SnapshotSummary | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Stats default desc (highest first); name/type/group default asc.
      const isStat = (STAT_KEYS as readonly string[]).includes(key);
      setSortDir(isStat ? "desc" : "asc");
    }
  }

  const filtered = useMemo(() => {
    let list = resources;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.typeDisplayName.toLowerCase().includes(q) ||
          r.typeId.toLowerCase().includes(q) ||
          r.groupId.toLowerCase().includes(q) ||
          r.planets.some((p) => p.toLowerCase().includes(q)),
      );
    }
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        if (sortKey === "name") {
          av = a.name;
          bv = b.name;
        } else if (sortKey === "type") {
          av = a.typeDisplayName;
          bv = b.typeDisplayName;
        } else if (sortKey === "group") {
          av = a.groupId;
          bv = b.groupId;
        } else {
          // Stat key — null sorts last regardless of direction so rows missing
          // a stat sink to the bottom when you click that column.
          const aRaw = a.stats[sortKey];
          const bRaw = b.stats[sortKey];
          if (aRaw === null && bRaw === null) return 0;
          if (aRaw === null) return 1;
          if (bRaw === null) return -1;
          av = aRaw;
          bv = bRaw;
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    return list;
  }, [resources, search, sortKey, sortDir]);

  const sortArrow = (key: SortKey): string => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="min-h-screen p-6">
      <header className="flex items-start justify-between mb-6 border-b border-zinc-800 pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">GalaxyCrafter</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Phase 1 — Foundation. SR2 spawn ingest only; verdicts, inventory, simulator come next.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-400 shrink-0">
          {latest && (
            <span className="text-right leading-tight">
              <span className="block text-zinc-300">{relativeAge(latest.fetchedAt)}</span>
              <span className="block text-xs text-zinc-500" title={new Date(latest.fetchedAt).toLocaleString()}>
                {latest.resourceCount} resources · galaxy {latest.galaxyId}
              </span>
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

      {resources.length === 0 && !busy && !error && (
        <p className="text-zinc-500">
          No snapshot yet. Click <strong className="text-zinc-300">Pull SR2 snapshot</strong> to
          fetch the current spawn list from galaxyharvester.net.
        </p>
      )}

      {resources.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name, type, group, or planet…"
              className="flex-1 max-w-md px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 text-sm"
            />
            <span className="text-xs text-zinc-500 tabular-nums">
              {search ? (
                <>
                  <span className="text-zinc-300">{filtered.length}</span> of {resources.length}
                </>
              ) : (
                <>
                  <span className="text-zinc-300">{resources.length}</span> resources
                </>
              )}
              {sortKey && (
                <>
                  {" · sorted by "}
                  <span className="text-zinc-300">
                    {sortKey} {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSortKey(null)}
                    className="ml-2 text-zinc-600 hover:text-zinc-300"
                  >
                    clear
                  </button>
                </>
              )}
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-300 sticky top-0">
                <tr>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 select-none"
                    onClick={() => toggleSort("name")}
                  >
                    Name{sortArrow("name")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 select-none"
                    onClick={() => toggleSort("type")}
                  >
                    Type{sortArrow("type")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 select-none"
                    onClick={() => toggleSort("group")}
                  >
                    Group{sortArrow("group")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Planets</th>
                  {STAT_KEYS.map((s) => (
                    <th
                      key={s}
                      className="px-2 py-2 text-right font-medium cursor-pointer hover:bg-zinc-800 select-none"
                      onClick={() => toggleSort(s)}
                    >
                      {s}
                      {sortArrow(s)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4 + STAT_KEYS.length}
                      className="px-3 py-6 text-center text-zinc-500"
                    >
                      No resources match <span className="text-zinc-300">"{search}"</span>
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-800 hover:bg-zinc-900/50">
                      <td className="px-3 py-2 font-mono text-zinc-100">{r.name}</td>
                      <td className="px-3 py-2 text-zinc-200">{r.typeDisplayName}</td>
                      <td className="px-3 py-2 text-zinc-500 font-mono text-xs">{r.groupId}</td>
                      <td className="px-3 py-2 text-zinc-400 text-xs">{r.planets.join(", ")}</td>
                      {STAT_KEYS.map((s) => {
                        const v = r.stats[s];
                        return (
                          <td
                            key={s}
                            className="px-2 py-2 text-right tabular-nums"
                          >
                            {v === null ? (
                              <span className="text-zinc-700">—</span>
                            ) : v >= 900 ? (
                              <span className="text-emerald-400 font-semibold">{v}</span>
                            ) : v >= 800 ? (
                              <span className="text-emerald-200">{v}</span>
                            ) : (
                              <span className="text-zinc-300">{v}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
