import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  SchematicDepNode,
  SchematicDepRawSlot,
  SchematicDepTreeResult,
  SchematicDetail as SchematicDetailType,
} from "@shared/ipc-types";
import { PROFESSIONS } from "@shared/professions";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

// Per Core3 DraftSlot.h enum:
//   0 = RESOURCESLOT
//   1 = IDENTICALSLOT
//   2 = MIXEDSLOT
//   3 = OPTIONALIDENTICALSLOT
//   4 = OPTIONALMIXEDSLOT
const INGREDIENT_TYPE_LABEL: Record<number, string> = {
  0: "raw resource",
  1: "identical component",
  2: "mixed component",
  3: "optional identical component",
  4: "optional mixed component",
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
          {detail.isActive && (
            <Link
              to={`/finder/${encodeURIComponent(detail.id)}`}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              Find top-scoring spawning resources →
            </Link>
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
                  <td className="px-3 py-2 text-xs">
                    <span className="text-slate-200">{slot.ingredientDisplayName}</span>
                    {slot.ingredientDisplayName !== slot.ingredientObject && (
                      <span className="ml-2 text-slate-600 font-mono">{slot.ingredientObject}</span>
                    )}
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

      {detail.dependencies.length > 0 && id && (
        <section className="mb-8">
          <DepTreeSection schematicId={id} initialDepCount={detail.dependencies.length} />
        </section>
      )}
    </div>
  );
}

interface DepTreeSectionProps {
  schematicId: string;
  initialDepCount: number;
}

function DepTreeSection({ schematicId, initialDepCount }: DepTreeSectionProps): JSX.Element {
  const [tree, setTree] = useState<SchematicDepTreeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxDepth, setMaxDepth] = useState(4);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.api.getSchematicDepTree(schematicId, maxDepth).then((r) => {
      if (cancelled) return;
      setTree(r);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [schematicId, maxDepth]);

  function nodeCount(node: SchematicDepNode): number {
    return 1 + node.children.reduce((s, c) => s + nodeCount(c), 0);
  }
  const totalNodes = tree ? nodeCount(tree.root) - 1 : initialDepCount;

  return (
    <>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-medium text-slate-300">
          Dependency tree ({totalNodes} sub-component{totalNodes === 1 ? "" : "s"})
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-500">Depth</label>
          <select
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200"
          >
            <option value={1}>1 (direct only)</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={6}>6</option>
            <option value={8}>8 (max)</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Every sub-component this schematic transitively consumes. Each node shows the slot it
        fills and the producing schematic. Hover a row for the raw-resource ingredients that
        schematic also needs. Cycles are skipped; deeper branches than the selected depth get a{" "}
        <span className="text-amber-400">⋯ more</span> marker.
      </p>
      {loading && !tree && <p className="text-slate-500 text-sm">Loading tree…</p>}
      {tree && (
        <div className="rounded-md border border-slate-700 bg-slate-900 p-3">
          {tree.root.children.length === 0 ? (
            <p className="text-xs text-slate-500">
              This schematic has no sub-component dependencies.
            </p>
          ) : (
            <ul className="text-sm">
              {tree.root.children.map((child) => (
                <DepTreeNode
                  key={`${child.schematicId}-${child.parentSlotName}`}
                  node={child}
                  rawSlots={tree.rawSlotsBySchematic[child.schematicId] ?? []}
                  allRawSlots={tree.rawSlotsBySchematic}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

interface DepTreeNodeProps {
  node: SchematicDepNode;
  rawSlots: SchematicDepRawSlot[];
  allRawSlots: Record<string, SchematicDepRawSlot[]>;
}

// Compact slot-type pill labels for the dep-tree node header.
const INGREDIENT_KIND_LABEL: Record<number, string> = {
  1: "identical",
  2: "mixed",
  3: "identical",
  4: "mixed",
};

function DepTreeNode({ node, rawSlots, allRawSlots }: DepTreeNodeProps): JSX.Element {
  const [open, setOpen] = useState(node.depth <= 1);
  const profession = PROFESSIONS.find((p) => p.id === node.profession);
  const kindLabel =
    node.parentIngredientType !== null
      ? INGREDIENT_KIND_LABEL[node.parentIngredientType] ?? null
      : null;
  const hasChildren = node.children.length > 0 || node.truncated;
  const hasRawSlots = rawSlots.length > 0;
  const hasAlternates = node.alternateProducers.length > 0;

  // Compact raw-slot summary: list of ingredient-display-name strings.
  const rawSlotSummary = rawSlots
    .map((s) => `${s.unitsRequired}u ${s.displayName ?? s.ingredientObject}`)
    .join(" · ");

  return (
    <li
      className="border-l border-slate-700 pl-3 py-1 my-0.5"
      style={{ marginLeft: `${(node.depth - 1) * 8}px` }}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-slate-500 hover:text-slate-200 font-mono text-xs w-3"
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="text-slate-700 font-mono text-xs w-3">·</span>
        )}
        {node.parentSlotName && (
          <span className="text-[10px] font-mono text-slate-500" title={node.parentSlotName}>
            [{node.parentSlotName}]
          </span>
        )}
        {node.parentOptional && (
          <span
            className="px-1 py-0.5 rounded border border-amber-800 bg-amber-950/40 text-amber-300 text-[9px] font-medium leading-none"
            title="Slot is optional — craft works without it; filling grants enhancements (often looted exotic components)."
          >
            OPTIONAL
          </span>
        )}
        <Link
          to={`/schematics/${node.schematicId}`}
          className="text-emerald-400 hover:text-emerald-300 text-sm"
        >
          {node.schematicName}
        </Link>
        {profession && (
          <span className="text-[10px] text-slate-500">· {profession.name}</span>
        )}
        {kindLabel && (
          <span
            className="text-[10px] text-slate-600 font-mono"
            title={`Slot type: ${kindLabel}${node.parentOptional ? " (optional)" : ""}`}
          >
            ({kindLabel})
          </span>
        )}
        {node.truncated && (
          <span className="text-[10px] text-amber-400 font-mono">⋯ more</span>
        )}
      </div>
      {hasAlternates && (
        <div className="ml-6 mt-1 text-[11px] text-slate-500 leading-tight flex flex-wrap gap-x-2 gap-y-1">
          <span className="text-slate-600">or:</span>
          {node.alternateProducers.map((a) => (
            <Link
              key={a.schematicId}
              to={`/schematics/${a.schematicId}`}
              className="text-cyan-400 hover:text-cyan-300"
              title={`Substitutable producer via IFF derivation${
                a.profession ? ` · ${a.profession}` : ""
              }`}
            >
              {a.schematicName}
            </Link>
          ))}
        </div>
      )}
      {hasRawSlots && open && (
        <div className="ml-6 mt-1 text-[11px] text-slate-500 leading-tight">
          {rawSlotSummary}
        </div>
      )}
      {open && node.children.length > 0 && (
        <ul className="mt-1">
          {node.children.map((c) => (
            <DepTreeNode
              key={`${c.schematicId}-${c.parentSlotName}-${c.depth}`}
              node={c}
              rawSlots={allRawSlots[c.schematicId] ?? []}
              allRawSlots={allRawSlots}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
