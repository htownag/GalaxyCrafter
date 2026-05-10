import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SchematicSummary } from "@shared/ipc-types";
import { PROFESSIONS } from "@shared/professions";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

export function Schematics(): JSX.Element {
  const { character } = useActiveCharacter();
  const [allSchematics, setAllSchematics] = useState<SchematicSummary[]>([]);
  const [query, setQuery] = useState("");
  const [profFilter, setProfFilter] = useState<string>("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void window.api
      .listSchematics({})
      .then(setAllSchematics)
      .finally(() => setLoading(false));
  }, [character]);

  const filtered = useMemo(() => {
    let list = allSchematics;
    if (profFilter) list = list.filter((s) => s.profession === profFilter);
    if (onlyActive) list = list.filter((s) => s.isActive);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.craftingTab ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [allSchematics, query, profFilter, onlyActive]);

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-zinc-100">Schematics</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          1,710 vanilla schematics from GH seedData (publish9 vintage). Click any to view slots +
          property weights or add to your active craft list.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='e.g. "t21" or "carbine"'
          className="flex-1 max-w-md px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 text-sm"
        />
        <select
          value={profFilter}
          onChange={(e) => setProfFilter(e.target.value)}
          className="px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm"
        >
          <option value="">All professions</option>
          {PROFESSIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
            className="accent-emerald-600"
          />
          Active only
        </label>
        <span className="text-xs text-zinc-500 tabular-nums ml-auto">
          {loading ? "…" : (
            <>
              <span className="text-zinc-300">{filtered.length}</span> of {allSchematics.length}
            </>
          )}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-300 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Profession</th>
              <th className="px-3 py-2 text-left font-medium">Crafting tab</th>
              <th className="px-3 py-2 text-right font-medium">Complexity</th>
              <th className="px-3 py-2 text-center font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-zinc-500">
                  {loading ? "Loading…" : "No matches"}
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-zinc-800 hover:bg-zinc-900/50"
                >
                  <td className="px-3 py-2">
                    <Link
                      to={`/schematics/${s.id}`}
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      {s.name}
                    </Link>
                    <div className="text-xs text-zinc-600 font-mono">{s.id}</div>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {s.profession ? (
                      PROFESSIONS.find((p) => p.id === s.profession)?.name ?? s.profession
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-500 text-xs font-mono">
                    {s.craftingTab ?? <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300 tabular-nums">{s.complexity}</td>
                  <td className="px-3 py-2 text-center">
                    {s.isActive ? (
                      <span className="text-emerald-400">✓</span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
