import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SchematicDetail as SchematicDetailType } from "@shared/ipc-types";
import { PROFESSIONS } from "@shared/professions";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

const INGREDIENT_TYPE_LABEL: Record<number, string> = {
  0: "raw resource",
  1: "specific component",
  2: "mixed component",
  3: "base-class component",
};

export function SchematicDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { character } = useActiveCharacter();
  const [detail, setDetail] = useState<SchematicDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [withSubs, setWithSubs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const d = await window.api.getSchematicDetail(id);
    setDetail(d);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(): Promise<void> {
    if (!character || !id) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.api.addActiveSchematic(character.id, id, withSubs);
      setMessage(
        `Added ${result.added.length} schematic${result.added.length === 1 ? "" : "s"} (${result.skipped.length} already active).`,
      );
      await load();
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!character || !id) return;
    setBusy(true);
    setMessage(null);
    try {
      await window.api.removeActiveSchematic(character.id, id);
      setMessage("Removed from active list.");
      await load();
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (!detail) {
    return (
      <div className="p-6 text-slate-400">
        Schematic not found.{" "}
        <Link to="/schematics" className="text-emerald-400 hover:text-emerald-300">
          Back to list
        </Link>
        .
      </div>
    );
  }

  const realPropertyGroups = detail.propertyGroups.filter((g) => g.propertyName && g.expGroup);

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-1">
        <Link to="/schematics" className="text-xs text-slate-400 hover:text-slate-300">
          ← Schematics
        </Link>
      </div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">{detail.name}</h2>
          <p className="text-xs text-slate-400 font-mono mt-1">{detail.id}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
            {detail.profession && (
              <span>
                <span className="text-slate-600">profession:</span>{" "}
                <span className="text-slate-300">
                  {PROFESSIONS.find((p) => p.id === detail.profession)?.name ?? detail.profession}
                </span>
              </span>
            )}
            {detail.craftingTab && (
              <span>
                <span className="text-slate-600">tab:</span>{" "}
                <span className="text-slate-300 font-mono">{detail.craftingTab}</span>
              </span>
            )}
            <span>
              <span className="text-slate-600">complexity:</span>{" "}
              <span className="text-slate-300">{detail.complexity}</span>
            </span>
            {detail.skillGroup && (
              <span>
                <span className="text-slate-600">skill group:</span>{" "}
                <span className="text-slate-300 font-mono">{detail.skillGroup}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {character ? (
            detail.isActive ? (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="px-4 py-2 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 text-sm"
              >
                {busy ? "…" : "Remove from active"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={add}
                  disabled={busy}
                  className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-sm"
                >
                  {busy ? "…" : "Add to active"}
                </button>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={withSubs}
                    onChange={(e) => setWithSubs(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  also add {detail.dependencies.length} sub-component{detail.dependencies.length === 1 ? "" : "s"}
                </label>
              </>
            )
          ) : (
            <span className="text-xs text-slate-400">Create a character to enable active list.</span>
          )}
        </div>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-md border border-emerald-900 bg-emerald-950/40 text-emerald-200 text-sm">
          {message}
        </div>
      )}

      <section className="mb-8">
        <h3 className="text-sm font-medium text-slate-300 mb-2">
          Ingredient slots ({detail.slots.length})
        </h3>
        <div className="overflow-x-auto rounded-md border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Slot</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Accepts</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
              </tr>
            </thead>
            <tbody>
              {detail.slots.map((slot) => (
                <tr key={slot.slotName} className="border-t border-slate-700">
                  <td className="px-3 py-2 text-slate-100 font-mono text-xs">{slot.slotName}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">
                    {INGREDIENT_TYPE_LABEL[slot.ingredientType] ?? `type ${slot.ingredientType}`}
                  </td>
                  <td className="px-3 py-2 text-slate-300 font-mono text-xs">
                    {slot.ingredientObject}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300 tabular-nums">
                    {slot.unitsRequired}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h3 className="text-sm font-medium text-slate-300 mb-2">
          Experimental property groups ({realPropertyGroups.length} experiment-able
          {detail.propertyGroups.length - realPropertyGroups.length > 0 &&
            `; ${detail.propertyGroups.length - realPropertyGroups.length} derived`})
        </h3>
        <div className="overflow-x-auto rounded-md border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Property</th>
                <th className="px-3 py-2 text-left font-medium">Group</th>
                <th className="px-3 py-2 text-left font-medium">Stat weights</th>
              </tr>
            </thead>
            <tbody>
              {realPropertyGroups.map((g) => {
                const total = g.weights.reduce((sum, w) => sum + w.weight, 0) || 1;
                return (
                  <tr key={g.id} className="border-t border-slate-700">
                    <td className="px-3 py-2 text-slate-100 text-xs">{g.propertyName}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs font-mono">{g.expGroup}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap gap-2">
                        {g.weights.length === 0 ? (
                          <span className="text-slate-600">(no stat weights)</span>
                        ) : (
                          g.weights.map((w) => (
                            <span
                              key={w.stat}
                              className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-200"
                            >
                              <span className="font-mono">{w.stat}</span>
                              <span className="text-slate-400"> {Math.round((w.weight / total) * 100)}%</span>
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {detail.dependencies.length > 0 && (
        <section className="mb-8">
          <h3 className="text-sm font-medium text-slate-300 mb-2">
            Sub-component schematics ({detail.dependencies.length})
          </h3>
          <p className="text-xs text-slate-400 mb-2">
            These schematics produce components this schematic consumes as input. When you add this
            schematic with sub-components, they're added as inherited entries.
          </p>
          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Slot</th>
                  <th className="px-3 py-2 text-left font-medium">Sub-component schematic</th>
                </tr>
              </thead>
              <tbody>
                {detail.dependencies.map((d) => (
                  <tr key={`${d.slotName}-${d.childSchematicId}`} className="border-t border-slate-700">
                    <td className="px-3 py-2 text-slate-400 font-mono text-xs">{d.slotName}</td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/schematics/${d.childSchematicId}`}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        {d.childName}
                      </Link>
                      <span className="ml-2 text-xs text-slate-600 font-mono">
                        {d.childSchematicId}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
