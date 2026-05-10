import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ActiveSchematicEntry } from "@shared/ipc-types";
import { PROFESSIONS } from "@shared/professions";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

export function ActiveSchematics(): JSX.Element {
  const { character } = useActiveCharacter();
  const [entries, setEntries] = useState<ActiveSchematicEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!character) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const list = await window.api.listActiveSchematics(character.id);
    setEntries(list);
    setLoading(false);
  }, [character]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(schematicId: string): Promise<void> {
    if (!character) return;
    await window.api.removeActiveSchematic(character.id, schematicId);
    await load();
  }

  if (!character) {
    return (
      <div className="p-6 text-zinc-500">
        No active character. Create one in{" "}
        <Link to="/character" className="text-emerald-400 hover:text-emerald-300">
          Character
        </Link>
        .
      </div>
    );
  }

  // Group: user-added first, then inherited grouped by parent.
  const userAdded = entries.filter((e) => e.source === "user");
  const inheritedByParent = new Map<string, ActiveSchematicEntry[]>();
  for (const e of entries) {
    if (e.source !== "inherited" || !e.parentSchematicId) continue;
    const arr = inheritedByParent.get(e.parentSchematicId) ?? [];
    arr.push(e);
    inheritedByParent.set(e.parentSchematicId, arr);
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-zinc-100">Active schematics</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          {entries.length} on {character.name}. These drive the verdict engine (Phase 3 — coming next).
        </p>
      </div>

      {loading && <p className="text-zinc-500">Loading…</p>}

      {!loading && entries.length === 0 && (
        <p className="text-zinc-500">
          None yet. Go to{" "}
          <Link to="/schematics" className="text-emerald-400 hover:text-emerald-300">
            Schematics
          </Link>{" "}
          and pick a few to add.
        </p>
      )}

      {!loading && userAdded.length > 0 && (
        <section className="mb-8">
          <h3 className="text-sm font-medium text-zinc-300 mb-2">User-added</h3>
          <div className="overflow-x-auto rounded-md border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Profession</th>
                  <th className="px-3 py-2 text-left font-medium">Crafting tab</th>
                  <th className="px-3 py-2 text-right font-medium">Inherited subs</th>
                  <th className="px-3 py-2 w-0" />
                </tr>
              </thead>
              <tbody>
                {userAdded.map((e) => {
                  const subs = inheritedByParent.get(e.schematicId) ?? [];
                  return (
                    <tr key={e.schematicId} className="border-t border-zinc-800">
                      <td className="px-3 py-2">
                        <Link
                          to={`/schematics/${e.schematicId}`}
                          className="text-emerald-400 hover:text-emerald-300"
                        >
                          {e.schematicName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-zinc-300">
                        {e.profession
                          ? PROFESSIONS.find((p) => p.id === e.profession)?.name ?? e.profession
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-500 text-xs font-mono">
                        {e.craftingTab ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-400 tabular-nums">
                        {subs.length}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => remove(e.schematicId)}
                          className="text-xs text-zinc-500 hover:text-red-400"
                        >
                          remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && inheritedByParent.size > 0 && (
        <section>
          <h3 className="text-sm font-medium text-zinc-300 mb-2">Inherited (sub-components)</h3>
          <div className="space-y-3">
            {[...inheritedByParent.entries()].map(([parentId, subs]) => {
              const parent = entries.find((e) => e.schematicId === parentId);
              return (
                <div key={parentId} className="rounded-md border border-zinc-800 overflow-hidden">
                  <div className="bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
                    sub-components of{" "}
                    <Link
                      to={`/schematics/${parentId}`}
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      {parent?.schematicName ?? parentId}
                    </Link>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {subs.map((s) => (
                        <tr key={s.schematicId} className="border-t border-zinc-800">
                          <td className="px-3 py-2">
                            <Link
                              to={`/schematics/${s.schematicId}`}
                              className="text-emerald-400 hover:text-emerald-300"
                            >
                              {s.schematicName}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-zinc-500 text-xs font-mono">
                            {s.craftingTab ?? "—"}
                          </td>
                          <td className="px-3 py-2 w-0">
                            <button
                              type="button"
                              onClick={() => remove(s.schematicId)}
                              className="text-xs text-zinc-500 hover:text-red-400"
                            >
                              remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
