import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  CraftRecommendResult,
  CraftRecommendSlotResult,
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
            {/* v0.1.6 UNLOCK header pill: X/Y slots covered by inventory.
                Null when no active character. Green when fully covered,
                amber when partial, yellow (UNLOCK-flavored) when zero. */}
            {detail.rawSlotsCovered !== null && detail.rawSlotsTotal > 0 && (() => {
              const c = detail.rawSlotsCovered;
              const t = detail.rawSlotsTotal;
              const missing = t - c;
              const cls =
                missing === 0
                  ? "bg-emerald-900/50 border-emerald-700 text-emerald-200"
                  : c === 0
                    ? "bg-yellow-900/50 border-yellow-700 text-yellow-200"
                    : "bg-amber-900/50 border-amber-700 text-amber-200";
              return (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${cls}`}
                  title={
                    missing === 0
                      ? "All raw slots covered by your live or reserved inventory"
                      : `${missing} raw slot${missing === 1 ? "" : "s"} need a covering resource (live + reserved only — despawned doesn't count)`
                  }
                >
                  {c}/{t} slots covered
                  {missing > 0 && (
                    <span className="ml-1 opacity-80">— {missing} unlock{missing === 1 ? "" : "s"} needed</span>
                  )}
                </span>
              );
            })()}
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

      {detail.isActive && character && <CraftingPlanPanel schematicId={detail.id} />}

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

// =============================================================
// Phase 9d — Crafting plan panel
// =============================================================
//
// Per-slot "what's the best resource I currently own for this craft, and is
// there an upgrade available in current spawns?" view. Property-group
// dropdown drives the scoring across the whole pane (a weapon's expDamage
// rewards different stats than its expRange, etc., so the player picks
// which experiment they care about). Calls `schematics:recommendCraft`
// which scores via the same verdict-engine helpers.

function CraftingPlanPanel({ schematicId }: { schematicId: string }): JSX.Element {
  const [data, setData] = useState<CraftRecommendResult | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.recommendCraft({
        schematicId,
        propertyGroupId: groupId ?? undefined,
      });
      setData(result);
      if (result && groupId === null) setGroupId(result.selectedGroup.id);
    } finally {
      setLoading(false);
    }
  }, [schematicId, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch when verdicts:updated fires (snapshot ingest, inventory edit,
  // active-list change). Keeps the plan in sync with the live state.
  useEffect(() => {
    const off = window.api.onVerdictsUpdated(() => {
      void load();
    });
    return off;
  }, [load]);

  if (loading && !data) {
    return (
      <section className="mb-8 rounded-md border border-slate-700 bg-slate-900 p-4">
        <p className="text-xs text-slate-500">Loading crafting plan…</p>
      </section>
    );
  }
  if (!data) return <></>;

  return (
    <section className="mb-8 rounded-md border border-emerald-800 bg-emerald-950/20 p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold text-emerald-300">
          Crafting plan — best owned per slot
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-400">Score for:</label>
          <select
            value={groupId ?? ""}
            onChange={(e) => setGroupId(Number(e.target.value))}
            disabled={data.availableGroups.length === 0}
            className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100"
          >
            {data.availableGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.propertyName ?? "(unnamed)"}{g.expGroup ? ` · ${g.expGroup}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {data.availableGroups.length === 0 ? (
        <p className="text-xs text-slate-500">
          This schematic has no scoreable property groups — nothing to recommend.
        </p>
      ) : data.inventoryEmpty ? (
        <p className="text-xs text-amber-300">
          Your Crates are empty. Add owned resources on the{" "}
          <Link to="/inventory" className="underline hover:text-amber-100">
            Crates tab
          </Link>{" "}
          and verdicts here will compare them against current spawns.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-300 text-xs">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Slot</th>
                <th className="px-2 py-2 text-left font-medium">Best owned</th>
                <th className="px-2 py-2 text-right font-medium">Score</th>
                <th className="px-2 py-2 text-right font-medium">Units</th>
                <th className="px-2 py-2 text-left font-medium">Upgrade in current spawns</th>
              </tr>
            </thead>
            <tbody>
              {data.slots.map((slot) => (
                <CraftingPlanRow key={slot.slotName} slot={slot} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-500 mt-2 leading-tight">
        Scoring uses the verdict engine's universal 0..100 scale for the selected property group's
        stat weights. "Upgrade" flags spawn-vs-owned deltas above 1.0 point.
      </p>
    </section>
  );
}

function CraftingPlanRow({ slot }: { slot: CraftRecommendSlotResult }): JSX.Element {
  if (slot.isSubComponent) {
    return (
      <tr className="border-t border-slate-700">
        <td className="px-2 py-1.5">
          <span className="text-slate-200 text-xs">{humaniseSlotName(slot.slotName)}</span>
          <span className="ml-1 text-[10px] text-slate-500">(sub-component)</span>
        </td>
        <td className="px-2 py-1.5 text-xs text-slate-500" colSpan={4}>
          Sub-component — craft separately. See the dependency tree below.
        </td>
      </tr>
    );
  }

  if (!slot.bestOwned) {
    // v0.1.6 UNLOCK framing: the slot is uncovered, so any spawn is a
    // stockpile-builder, not a quality upgrade. Yellow UNLOCK badge + label
    // so the player sees "grab this — it's my first" not "chase this for
    // quality."
    return (
      <tr className="border-t border-yellow-900/40 bg-yellow-950/10">
        <td className="px-2 py-1.5">
          <span className="text-slate-200 text-xs">{humaniseSlotName(slot.slotName)}</span>
          <span className="ml-1 text-[10px] text-slate-500 font-mono">
            {slot.unitsRequired}u · {slot.ingredientDisplayName ?? slot.ingredientObject}
          </span>
        </td>
        <td className="px-2 py-1.5 text-xs" colSpan={3}>
          <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-medium bg-yellow-900/50 border-yellow-700 text-yellow-200 mr-2">
            UNLOCK
          </span>
          <span className="text-yellow-300/80">no covering inventory</span>
        </td>
        <td className="px-2 py-1.5 text-xs">
          {slot.bestSpawning ? (
            <span className="text-yellow-200">
              <span className="font-medium">grab any spawn:</span>{" "}
              {slot.bestSpawning.resourceName} ({slot.bestSpawning.score.toFixed(1)})
            </span>
          ) : (
            <span className="text-slate-500">no current spawns either</span>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-slate-700">
      <td className="px-2 py-1.5">
        <span className="text-slate-200 text-xs">{humaniseSlotName(slot.slotName)}</span>
        <span className="ml-1 text-[10px] text-slate-500 font-mono">
          {slot.unitsRequired}u · {slot.ingredientDisplayName ?? slot.ingredientObject}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <Link
          to={`/resources/${slot.bestOwned.resourceId}`}
          className="text-emerald-400 hover:text-emerald-300 text-xs"
        >
          {slot.bestOwned.resourceName}
        </Link>
        <span className="ml-1 text-[10px] text-slate-500">{slot.bestOwned.typeDisplayName}</span>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-100">
        {slot.bestOwned.score.toFixed(1)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400 text-xs">
        {slot.bestOwned.unitsOnHand.toLocaleString()}
      </td>
      <td className="px-2 py-1.5 text-xs">
        {slot.upgradeAvailable && slot.bestSpawning && slot.upgradeDelta !== null ? (
          <span>
            <span className="text-amber-300 font-semibold">CHASE</span>{" "}
            <Link
              to={`/resources/${slot.bestSpawning.resourceId}`}
              className="text-amber-300 hover:text-amber-200 underline"
            >
              {slot.bestSpawning.resourceName}
            </Link>{" "}
            <span className="text-slate-400">
              ({slot.bestSpawning.score.toFixed(1)}, +{slot.upgradeDelta.toFixed(1)})
            </span>
          </span>
        ) : slot.bestSpawning?.sameAsOwned ? (
          <span className="text-slate-500">— same resource spawning —</span>
        ) : slot.bestSpawning && slot.upgradeDelta !== null ? (
          <span className="text-slate-500">
            best spawn: {slot.bestSpawning.resourceName} ({slot.bestSpawning.score.toFixed(1)},
            {slot.upgradeDelta >= 0 ? "+" : ""}{slot.upgradeDelta.toFixed(1)})
          </span>
        ) : (
          <span className="text-slate-500">no current spawn</span>
        )}
      </td>
    </tr>
  );
}

/** snake_case slot names → display ("frame_assembly" → "Frame Assembly"). */
function humaniseSlotName(s: string): string {
  return s
    .split(/[_\s]+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
