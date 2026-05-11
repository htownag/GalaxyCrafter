import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  ActiveSchematicEntry,
  FinderResult,
  FinderResultRow,
} from "@shared/ipc-types";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

// Phase 5 Resource Finder — inverts the GH "min/max per stat" model into
// a schematic-driven reverse search:
//   pick a schematic → pick which property group to optimise for →
//   ranked list of all currently-spawning resources scored against that
//   group's weights.
// Reuses the verdict engine's scoring + compat resolvers via the
// finder:rank IPC. Initial ship: active-list scoped, slot-filter on by
// default; weight override + browse-all schematics are deferred polish.

function WeightChips({
  weights,
}: {
  weights: Array<{ stat: string; weight: number }>;
}): JSX.Element {
  const total = weights.reduce((s, w) => s + w.weight, 0) || 1;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {weights.map((w) => (
        <span
          key={w.stat}
          className="inline-flex items-center px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 text-[10px]"
        >
          <span className="font-mono text-slate-200">{w.stat}</span>
          <span className="ml-1 text-slate-500">{Math.round((w.weight / total) * 100)}%</span>
        </span>
      ))}
    </span>
  );
}

function ScoreCell({ score }: { score: number }): JSX.Element {
  const cls =
    score >= 85
      ? "text-emerald-400 font-semibold"
      : score >= 65
        ? "text-amber-300"
        : score >= 40
          ? "text-slate-300"
          : "text-slate-500";
  return <span className={`tabular-nums ${cls}`}>{score.toFixed(1)}</span>;
}

function DeltaCell({ score, scoreOwned }: { score: number; scoreOwned: number }): JSX.Element {
  if (scoreOwned <= 0) return <span className="text-slate-700">—</span>;
  const d = score - scoreOwned;
  const cls = d >= 3 ? "text-emerald-400" : d >= 0 ? "text-slate-400" : "text-red-400";
  return (
    <span className={`tabular-nums ${cls}`}>
      {d >= 0 ? "+" : ""}
      {d.toFixed(1)}
    </span>
  );
}

export function Finder(): JSX.Element {
  const { schematicId: routeSchematicId } = useParams<{ schematicId?: string }>();
  const { character } = useActiveCharacter();
  const navigate = useNavigate();
  const [activeList, setActiveList] = useState<ActiveSchematicEntry[]>([]);
  const [activeListLoaded, setActiveListLoaded] = useState(false);
  const [selectedSchematicId, setSelectedSchematicId] = useState<string | null>(
    routeSchematicId ?? null,
  );
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [result, setResult] = useState<FinderResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the active list once; the picker dropdown is fed from this.
  useEffect(() => {
    if (!character) {
      setActiveList([]);
      setActiveListLoaded(true);
      return;
    }
    void window.api.listActiveSchematics(character.id).then((list) => {
      setActiveList(list);
      setActiveListLoaded(true);
      // If no schematic is selected via route param and the list is non-empty,
      // default to the first one to give the user something to look at.
      if (!routeSchematicId && list.length > 0) {
        setSelectedSchematicId(list[0].schematicId);
      }
    });
  }, [character, routeSchematicId]);

  // Sync URL when user picks a different schematic from the dropdown.
  function pickSchematic(id: string): void {
    setSelectedSchematicId(id);
    setSelectedGroupId(null); // reset group; handler will default to first scoreable
    navigate(`/finder/${encodeURIComponent(id)}`, { replace: false });
  }

  const load = useCallback(async () => {
    if (!selectedSchematicId) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await window.api.rankResourcesForSchematic({
        schematicId: selectedSchematicId,
        propertyGroupId: selectedGroupId ?? undefined,
        slotFilter: true,
      });
      setResult(r);
      // Sync state with what the handler chose (it may default the group).
      if (r && selectedGroupId === null) {
        setSelectedGroupId(r.selectedGroup.id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedSchematicId, selectedGroupId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch when a recompute fires (snapshot or inventory change shifts
  // scoreOwned and the score-weighted ranking).
  useEffect(() => {
    if (!character) return;
    const unsub = window.api.onVerdictsUpdated((payload) => {
      if (payload.characterId === character.id) void load();
    });
    return unsub;
  }, [character, load]);

  const ownedCount = useMemo(() => result?.rows.filter((r) => r.owned).length ?? 0, [result]);

  if (!character) {
    return (
      <div className="p-6 text-slate-400">
        No active character. Create one in{" "}
        <Link to="/character" className="text-emerald-400 hover:text-emerald-300">
          Character
        </Link>
        .
      </div>
    );
  }

  if (activeListLoaded && activeList.length === 0) {
    return (
      <div className="p-6 text-slate-400">
        No active schematics. Add one from{" "}
        <Link to="/schematics" className="text-emerald-400 hover:text-emerald-300">
          Schematics
        </Link>{" "}
        to rank spawning resources against it.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-slate-100">Resource Finder</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Pick a schematic + property group → see every spawning resource ranked against its
          weights. Only resources that fit a raw slot on the schematic are shown.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label htmlFor="finder-schem" className="block text-xs text-slate-400 mb-1">
            Schematic (active list)
          </label>
          <select
            id="finder-schem"
            value={selectedSchematicId ?? ""}
            onChange={(e) => pickSchematic(e.target.value)}
            className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm min-w-[18rem]"
          >
            {activeList.map((a) => (
              <option key={a.schematicId} value={a.schematicId}>
                {a.schematicName}
                {a.source === "inherited" ? " (sub)" : ""}
              </option>
            ))}
          </select>
        </div>

        {result && result.availableGroups.length > 0 && (
          <div>
            <label htmlFor="finder-group" className="block text-xs text-slate-400 mb-1">
              Property group
            </label>
            <select
              id="finder-group"
              value={result.selectedGroup.id}
              onChange={(e) => setSelectedGroupId(Number.parseInt(e.target.value, 10))}
              className="px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm min-w-[18rem]"
            >
              {result.availableGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.propertyName ?? "—"} ({g.expGroup ?? "—"})
                </option>
              ))}
            </select>
          </div>
        )}

        {result && (
          <div className="text-xs text-slate-400">
            <div className="text-slate-500">Weights</div>
            <div className="mt-1">
              <WeightChips weights={result.selectedGroup.weights} />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-900 bg-red-950 text-red-200 text-sm">
          {error}
        </div>
      )}

      {loading && <p className="text-slate-400">Scoring…</p>}

      {!loading && result && result.availableGroups.length === 0 && (
        <p className="text-slate-500 italic">
          This schematic has no scoreable experimental property groups. Pick another from the
          dropdown above.
        </p>
      )}

      {!loading && result && result.rows.length === 0 && result.availableGroups.length > 0 && (
        <p className="text-slate-500 italic">
          No spawning resources fit a raw slot on{" "}
          <span className="text-slate-300">{result.schematic.name}</span>. The current snapshot may
          not have any compatible types, or the schematic only consumes sub-components.
        </p>
      )}

      {!loading && result && result.rows.length > 0 && (
        <>
          <div className="text-xs text-slate-400 mb-2 tabular-nums">
            <span className="text-slate-300">{result.rows.length}</span> resources ranked ·{" "}
            <span className="text-cyan-300">{ownedCount}</span> owned ·{" "}
            <span className="text-slate-500">scoreOwned</span>{" "}
            <span className="text-slate-300">{result.rows[0].scoreOwned.toFixed(1)}</span>
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Resource</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Planets</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Δ vs owned</th>
                  <th className="px-3 py-2 text-left font-medium">Weighted stats</th>
                  <th className="px-3 py-2 text-left font-medium">Owned</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row: FinderResultRow, i) => (
                  <tr
                    key={row.resourceId}
                    className={`border-t border-slate-700 hover:bg-slate-800/50 ${
                      row.owned ? "bg-cyan-950/20" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-slate-500 tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/resources/${encodeURIComponent(row.resourceId)}`}
                        className="text-emerald-400 hover:text-emerald-300 font-mono"
                      >
                        {row.resourceName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{row.typeDisplayName}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">
                      {row.planets.length > 0 ? row.planets.join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ScoreCell score={row.score} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DeltaCell score={row.score} scoreOwned={row.scoreOwned} />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="inline-flex flex-wrap gap-1">
                        {row.weightedStats.map((s) => (
                          <span
                            key={s.stat}
                            className={`inline-flex items-center px-1.5 py-0.5 rounded border ${
                              s.value === null
                                ? "border-slate-700 bg-slate-800 text-slate-700"
                                : "border-slate-700 bg-slate-800 text-slate-200"
                            }`}
                          >
                            <span className="font-mono">{s.stat}</span>
                            <span className="ml-1 tabular-nums">
                              {s.value === null ? "—" : s.value}
                            </span>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.owned && row.ownedUnits !== null ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md border bg-cyan-900/40 border-cyan-700 text-cyan-200 text-[11px] font-medium tabular-nums">
                          {row.ownedUnits.toLocaleString()}u
                        </span>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
