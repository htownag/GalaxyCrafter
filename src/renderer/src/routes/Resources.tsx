import type { Resource, SnapshotSummary, StatKey, VerdictEntry } from "@shared/ipc-types";
import { STAT_KEYS } from "@shared/ipc-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

type SortKey = "verdict" | "name" | "type" | "group" | StatKey;
type SortDir = "asc" | "desc";

// Sort key for the verdict column. CHASE > MAYBE > none, and within tier,
// higher topScore wins. Encoded as a single number so the shared sort
// comparator below stays simple.
function verdictSortValue(v: VerdictEntry | undefined): number {
  if (!v) return -1;
  const tierBase = v.tier === "CHASE" ? 2000 : v.tier === "MAYBE" ? 1000 : 0;
  return tierBase + v.topScore;
}

function VerdictPill({ verdict }: { verdict: VerdictEntry }): JSX.Element {
  // 2026-modern UI: subtle filled chip with hover tooltip rather than a
  // pulsing badge. CHASE is the eye-magnet, MAYBE quieter.
  const cls =
    verdict.tier === "CHASE"
      ? "bg-emerald-900/60 border-emerald-700 text-emerald-200"
      : "bg-amber-900/50 border-amber-700 text-amber-200";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${cls}`}
      title={verdict.reason}
    >
      {verdict.tier}
    </span>
  );
}

export function Resources(): JSX.Element {
  const { character } = useActiveCharacter();
  const [latest, setLatest] = useState<SnapshotSummary | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [verdictsById, setVerdictsById] = useState<Map<string, VerdictEntry>>(new Map());
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
        if (character) {
          const vs = await window.api.listVerdicts(character.id);
          setVerdictsById(new Map(vs.map((v) => [v.resourceId, v])));
        } else {
          setVerdictsById(new Map());
        }
      } else {
        setResources([]);
        setVerdictsById(new Map());
      }
    } catch (e) {
      setError(String(e));
    }
  }, [character]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch verdicts whenever main signals a recompute. We refetch the
  // *whole* page because resource list may also have shifted (e.g. snapshot
  // refresh adds new spawns).
  useEffect(() => {
    if (!character) return;
    const unsub = window.api.onVerdictsUpdated((payload) => {
      if (payload.characterId === character.id) void load();
    });
    return unsub;
  }, [character, load]);

  async function refresh(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await window.api.refreshSnapshot();
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
        } else if (sortKey === "verdict") {
          av = verdictSortValue(verdictsById.get(a.id));
          bv = verdictSortValue(verdictsById.get(b.id));
        } else {
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
  }, [resources, search, sortKey, sortDir, verdictsById]);

  const sortArrow = (key: SortKey): string => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Current spawns</h2>
          <p className="text-xs text-slate-400 mt-0.5">SR2 resources from galaxyharvester.net</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium"
        >
          {busy ? "Refreshing…" : latest ? "Refresh Now" : "Pull SR2 snapshot"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-900 bg-red-950 text-red-200 text-sm">
          {error}
        </div>
      )}

      {resources.length === 0 && !busy && !error && (
        <p className="text-slate-400 mt-8">
          No snapshot yet. Click <strong className="text-slate-300">Pull SR2 snapshot</strong> to
          fetch the current spawn list.
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
              className="flex-1 max-w-md px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 text-sm"
            />
            <span className="text-xs text-slate-400 tabular-nums">
              {search ? (
                <>
                  <span className="text-slate-300">{filtered.length}</span> of {resources.length}
                </>
              ) : (
                <>
                  <span className="text-slate-300">{resources.length}</span> resources
                </>
              )}
              {character && verdictsById.size > 0 && (
                <>
                  {" · "}
                  <span className="text-emerald-300">
                    {Array.from(verdictsById.values()).filter((v) => v.tier === "CHASE").length}
                  </span>
                  {" CHASE / "}
                  <span className="text-amber-300">
                    {Array.from(verdictsById.values()).filter((v) => v.tier === "MAYBE").length}
                  </span>
                  {" MAYBE"}
                </>
              )}
              {sortKey && (
                <>
                  {" · sorted by "}
                  <span className="text-slate-300">
                    {sortKey} {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSortKey(null)}
                    className="ml-2 text-slate-600 hover:text-slate-300"
                  >
                    clear
                  </button>
                </>
              )}
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300 sticky top-0">
                <tr>
                  {character && (
                    <th
                      className="px-2 py-2 text-left font-medium cursor-pointer hover:bg-slate-800 select-none"
                      onClick={() => toggleSort("verdict")}
                      title="Your verdict for this resource"
                    >
                      Verdict{sortArrow("verdict")}
                    </th>
                  )}
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-slate-800 select-none"
                    onClick={() => toggleSort("name")}
                  >
                    Name{sortArrow("name")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-slate-800 select-none"
                    onClick={() => toggleSort("type")}
                  >
                    Type{sortArrow("type")}
                  </th>
                  <th
                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-slate-800 select-none"
                    onClick={() => toggleSort("group")}
                  >
                    Group{sortArrow("group")}
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Planets</th>
                  {STAT_KEYS.map((s) => (
                    <th
                      key={s}
                      className="px-2 py-2 text-right font-medium cursor-pointer hover:bg-slate-800 select-none"
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
                      colSpan={4 + STAT_KEYS.length + (character ? 1 : 0)}
                      className="px-3 py-6 text-center text-slate-400"
                    >
                      No resources match <span className="text-slate-300">"{search}"</span>
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const v = verdictsById.get(r.id);
                    return (
                      <tr key={r.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                        {character && (
                          <td className="px-2 py-2">
                            {v ? (
                              <VerdictPill verdict={v} />
                            ) : (
                              <span className="text-slate-700">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 font-mono text-slate-100">{r.name}</td>
                        <td className="px-3 py-2 text-slate-200">{r.typeDisplayName}</td>
                        <td className="px-3 py-2 text-slate-400 font-mono text-xs">{r.groupId}</td>
                        <td className="px-3 py-2 text-slate-400 text-xs">{r.planets.join(", ")}</td>
                        {STAT_KEYS.map((s) => {
                          const stat = r.stats[s];
                          return (
                            <td key={s} className="px-2 py-2 text-right tabular-nums">
                              {stat === null ? (
                                <span className="text-slate-700">—</span>
                              ) : stat >= 900 ? (
                                <span className="text-emerald-400 font-semibold">{stat}</span>
                              ) : stat >= 800 ? (
                                <span className="text-emerald-200">{stat}</span>
                              ) : (
                                <span className="text-slate-300">{stat}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
