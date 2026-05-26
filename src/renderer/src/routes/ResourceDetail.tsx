import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  InventoryStatus,
  ResourceDetail as ResourceDetailType,
  StatKey,
} from "@shared/ipc-types";
import { STAT_KEYS } from "@shared/ipc-types";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

const TIER_PILL: Record<"CHASE" | "MAYBE" | "SKIP", string> = {
  CHASE: "bg-emerald-900/60 border-emerald-700 text-emerald-200",
  MAYBE: "bg-amber-900/50 border-amber-700 text-amber-200",
  SKIP: "bg-slate-800 border-slate-700 text-slate-400",
};

function relativeAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "future";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * 11-stat panel. Each row shows the stat value, the type's cap, and a
 * filled bar showing percent-of-range. Nulls are dimmed (the resource's
 * type doesn't roll that stat).
 */
function StatPanel({
  stats,
  caps,
  floors,
}: {
  stats: ResourceDetailType["stats"];
  caps: Record<string, number>;
  floors: Record<string, number>;
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
      {STAT_KEYS.map((s: StatKey) => {
        const v = stats[s];
        const cap = caps[s] ?? 0;
        const floor = floors[s] ?? 0;
        const range = cap - floor;
        const applicable = cap > 0; // type rolls this stat
        const pct = v !== null && range > 0 ? Math.max(0, Math.min(1, (v - floor) / range)) : 0;
        const pctOfCap = v !== null && cap > 0 ? Math.max(0, Math.min(1, v / cap)) : 0;
        return (
          <div key={s} className="flex items-center gap-3 text-sm">
            <span className="font-mono w-8 text-slate-400">{s}</span>
            {applicable ? (
              <>
                <span
                  className={`w-12 text-right tabular-nums ${
                    v === null
                      ? "text-slate-700"
                      : pctOfCap >= 0.9
                        ? "text-emerald-400 font-semibold"
                        : pctOfCap >= 0.8
                          ? "text-emerald-200"
                          : "text-slate-200"
                  }`}
                >
                  {v ?? "—"}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${
                      pctOfCap >= 0.9
                        ? "bg-emerald-500"
                        : pctOfCap >= 0.8
                          ? "bg-emerald-700"
                          : pctOfCap >= 0.6
                            ? "bg-amber-700"
                            : "bg-slate-600"
                    }`}
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right text-[10px] text-slate-600 tabular-nums">
                  /{cap}
                </span>
              </>
            ) : (
              <span className="flex-1 text-xs text-slate-700 italic">
                does not roll for this type
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ResourceDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { character } = useActiveCharacter();
  const [detail, setDetail] = useState<ResourceDetailType | null>(null);
  const [loading, setLoading] = useState(true);

  // v0.1.7: inline "Add to Crates" form right under the verdict pills.
  // Faster than bouncing over to the Inventory route just to track one
  // spawn the user is already looking at.
  const [addOpen, setAddOpen] = useState(false);
  const [addUnits, setAddUnits] = useState("");
  const [addStatus, setAddStatus] = useState<InventoryStatus>("live");
  const [addNotes, setAddNotes] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const d = await window.api.getResourceDetail(id);
    setDetail(d);
    setLoading(false);
  }, [id]);

  async function submitAdd(): Promise<void> {
    if (!character || !detail) return;
    const n = Number.parseInt(addUnits, 10);
    if (!Number.isFinite(n) || n < 0) {
      setAddError("Units must be a non-negative whole number.");
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      await window.api.upsertInventory({
        characterId: character.id,
        resourceId: detail.id,
        units: n,
        status: addStatus,
        notes: addNotes.trim() || null,
      });
      setAddOpen(false);
      setAddUnits("");
      setAddNotes("");
      setAddStatus("live");
      // Reload the detail so the "In your Crates" section appears, the
      // verdict refreshes (UNLOCK may flip off if this resource just
      // covered a slot), and the active character's verdict cache is
      // re-read. Recompute happens server-side in upsertInventory.
      await load();
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAddSaving(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch when a recompute fires (e.g. snapshot refresh on another route).
  useEffect(() => {
    if (!character) return;
    const unsub = window.api.onVerdictsUpdated((payload) => {
      if (payload.characterId === character.id) void load();
    });
    return unsub;
  }, [character, load]);

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (!detail) {
    return (
      <div className="p-6 text-slate-400">
        Resource not found.{" "}
        <Link to="/resources" className="text-emerald-400 hover:text-emerald-300">
          Back to Resources
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-1">
        <Link to="/resources" className="text-xs text-slate-400 hover:text-slate-300">
          ← Resources
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100 font-mono">{detail.name}</h2>
          <p className="text-sm text-slate-300 mt-1">{detail.typeDisplayName}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
            <span>
              <span className="text-slate-600">group:</span>{" "}
              <span className="text-slate-300 font-mono">{detail.groupId}</span>
              {detail.groupName && (
                <span className="text-slate-500"> ({detail.groupName})</span>
              )}
            </span>
            <span title={new Date(detail.addedDate).toLocaleString()}>
              <span className="text-slate-600">age:</span>{" "}
              <span className="text-slate-300">{relativeAge(detail.addedDate)}</span>
            </span>
            {detail.enteredBy && (
              <span>
                <span className="text-slate-600">entered by:</span>{" "}
                <span className="text-slate-300">{detail.enteredBy}</span>
              </span>
            )}
          </div>
          {detail.planets.length > 0 && (
            <div className="mt-2 text-xs text-slate-400">
              <span className="text-slate-600">spawning on:</span>{" "}
              <span className="text-slate-300">{detail.planets.join(", ")}</span>
            </div>
          )}
        </div>

        {/* Top-right rail: verdict pills + "Add to Crates" button/form.
            Renders even without a verdict so the player can still track a
            spawn that hasn't matched any active schematic yet. */}
        {(detail.verdict || character) && (
          <div className="flex flex-col items-end gap-1">
            {detail.verdict && (
              <>
                <div className="flex items-center gap-1">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-md border text-sm font-medium ${TIER_PILL[detail.verdict.tier]}`}
                  >
                    {detail.verdict.tier}
                  </span>
                  {/* v0.1.6 UNLOCK badge — orthogonal to tier. */}
                  {detail.verdict.unlocksAny && (
                    <span
                      className="inline-flex items-center px-3 py-1 rounded-md border text-sm font-medium bg-yellow-900/50 border-yellow-700 text-yellow-200"
                      title={`UNLOCKS ${detail.verdict.unlocks.length} slot${detail.verdict.unlocks.length === 1 ? "" : "s"} you can't currently cover`}
                    >
                      UNLOCK
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-400 tabular-nums">
                  top score {detail.verdict.topScore.toFixed(1)}
                </span>
              </>
            )}
            {/* v0.1.7: Quick-add to Crates. Only shown when there's no
                existing inventory row (the "In your Crates" section below
                handles edits). One-click open of an inline form keeps the
                player on this page — no route bounce. */}
            {character && !detail.inventory && !addOpen && (
              <button
                type="button"
                onClick={() => {
                  setAddOpen(true);
                  setAddError(null);
                }}
                className="mt-1 px-3 py-1.5 rounded-md bg-cyan-700 hover:bg-cyan-600 text-cyan-100 text-xs font-medium border border-cyan-800"
              >
                + Add to Crates
              </button>
            )}
            {character && !detail.inventory && addOpen && (
              <div className="mt-1 p-3 rounded-md border border-cyan-800 bg-cyan-950/40 w-64">
                <h4 className="text-xs font-medium text-cyan-200 mb-2">
                  Add {detail.name} to Crates
                </h4>
                <div className="space-y-2">
                  <label className="block">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                      Units
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={addUnits}
                      onChange={(e) => setAddUnits(e.target.value)}
                      placeholder="e.g. 5000"
                      className="mt-0.5 w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-600 tabular-nums"
                      disabled={addSaving}
                      // biome-ignore lint/a11y/noAutofocus: form is opened by user click
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitAdd();
                        } else if (e.key === "Escape") {
                          setAddOpen(false);
                          setAddError(null);
                        }
                      }}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                      Status
                    </span>
                    <select
                      value={addStatus}
                      onChange={(e) => setAddStatus(e.target.value as InventoryStatus)}
                      disabled={addSaving}
                      className="mt-0.5 w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-sm"
                    >
                      <option value="live">live (covers UNLOCK)</option>
                      <option value="reserved">reserved (covers UNLOCK)</option>
                      <option value="despawned">despawned (does NOT cover)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                      Notes <span className="text-slate-600 normal-case">(optional)</span>
                    </span>
                    <input
                      type="text"
                      value={addNotes}
                      onChange={(e) => setAddNotes(e.target.value)}
                      placeholder="e.g. west of Bestine"
                      className="mt-0.5 w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 text-xs"
                      disabled={addSaving}
                    />
                  </label>
                  {addError && (
                    <p className="text-[11px] text-red-300">{addError}</p>
                  )}
                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAddOpen(false);
                        setAddError(null);
                      }}
                      disabled={addSaving}
                      className="px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitAdd()}
                      disabled={addSaving}
                      className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-medium"
                    >
                      {addSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* When the resource IS already in inventory, the existing
                "In your Crates" section below has the edit link. We don't
                duplicate it here — the in-page section is more informative
                (shows current units + notes). */}
          </div>
        )}
      </div>

      <section className="mb-8">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Stats</h3>
        <StatPanel stats={detail.stats} caps={detail.caps} floors={detail.floors} />
      </section>

      {/* v0.1.6 UNLOCK section — surface the per-schematic / slot detail so
          the player can navigate to the schematic that needs this resource. */}
      {detail.verdict?.unlocksAny && detail.verdict.unlocks.length > 0 && (
        <section className="mb-8">
          <h3 className="text-sm font-medium text-yellow-300 mb-2">
            This resource UNLOCKS — {detail.verdict.unlocks.length} slot
            {detail.verdict.unlocks.length === 1 ? "" : "s"} you can't currently cover
          </h3>
          <p className="text-xs text-slate-400 mb-2">
            Tracked schematics with a raw slot this resource fits, where you
            don't yet own any covering resource (live or reserved). Grab any
            spawn — even a low-quality one — to unblock the craft.
          </p>
          <div className="overflow-x-auto rounded-md border border-yellow-900/50">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Schematic</th>
                  <th className="px-3 py-2 text-left font-medium">Slot</th>
                  <th className="px-3 py-2 text-left font-medium">Ingredient family</th>
                </tr>
              </thead>
              <tbody>
                {detail.verdict.unlocks.map((u) => (
                  <tr
                    key={`${u.schematicId}|${u.slotName}`}
                    className="border-t border-slate-700 hover:bg-slate-800/50"
                  >
                    <td className="px-3 py-2">
                      <Link
                        to={`/schematics/${encodeURIComponent(u.schematicId)}`}
                        className="text-yellow-200 hover:text-yellow-100"
                      >
                        {u.schematicName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-200">{u.slotName}</td>
                    <td className="px-3 py-2 text-slate-400 font-mono text-xs">
                      {u.ingredientObject}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detail.sbFlags.length > 0 && (
        <section className="mb-8">
          <h3 className="text-sm font-medium text-slate-300 mb-2">
            Server-best ({detail.sbFlags.length} profession
            {detail.sbFlags.length === 1 ? "" : "s"})
          </h3>
          <p className="text-xs text-slate-400 mb-2">
            How this resource ranks across crafting professions, independent of your active list.
            ★ = the best-known score for that profession on the current snapshot. ☆ = within 5% of
            it.
          </p>
          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Profession</th>
                  <th className="px-3 py-2 text-left font-medium">Tier</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Server top</th>
                  <th className="px-3 py-2 text-left font-medium">Best schematic</th>
                </tr>
              </thead>
              <tbody>
                {[...detail.sbFlags]
                  .sort((a, b) => {
                    if (a.tier !== b.tier) return a.tier === "SB_TOP" ? -1 : 1;
                    return b.score - a.score;
                  })
                  .map((f) => (
                    <tr
                      key={`${f.forProfession}|${f.tier}`}
                      className="border-t border-slate-700 hover:bg-slate-800/50"
                    >
                      <td className="px-3 py-2 text-slate-200">{f.forProfession}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${
                            f.tier === "SB_TOP"
                              ? "bg-yellow-900/50 border-yellow-700 text-yellow-200"
                              : "bg-transparent border-yellow-800 text-yellow-300/70"
                          }`}
                        >
                          {f.tier === "SB_TOP" ? "★ SB_TOP" : "☆ SB_NEAR"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-300">
                        {f.score.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                        {f.topScoreOnSnapshot.toFixed(1)}
                      </td>
                      <td className="px-3 py-2">
                        {f.schematicId ? (
                          <Link
                            to={`/schematics/${f.schematicId}`}
                            className="text-emerald-400 hover:text-emerald-300 font-mono text-xs"
                          >
                            {f.schematicId}
                          </Link>
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detail.inventory && (
        <section className="mb-8">
          <h3 className="text-sm font-medium text-slate-300 mb-2">In your Crates</h3>
          <div className="rounded-md border border-cyan-800 bg-cyan-950/30 px-4 py-3 text-sm">
            <div className="flex items-baseline gap-4">
              <span className="text-cyan-200 text-2xl font-semibold tabular-nums">
                {detail.inventory.units.toLocaleString()}
              </span>
              <span className="text-cyan-300/80 text-xs">units</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${
                  detail.inventory.status === "live"
                    ? "bg-emerald-900/40 border-emerald-700 text-emerald-200"
                    : detail.inventory.status === "reserved"
                      ? "bg-amber-900/40 border-amber-700 text-amber-200"
                      : "bg-slate-800 border-slate-700 text-slate-300"
                }`}
              >
                {detail.inventory.status}
              </span>
              <span
                className="text-xs text-slate-500 ml-auto"
                title={new Date(detail.inventory.updatedAt).toLocaleString()}
              >
                updated {relativeAge(detail.inventory.updatedAt)}
              </span>
            </div>
            {detail.inventory.notes && (
              <div className="mt-2 text-xs text-slate-300">{detail.inventory.notes}</div>
            )}
            <div className="mt-2 text-[11px] text-cyan-400/80">
              <Link to="/inventory" className="hover:text-cyan-200">
                Edit in Crates →
              </Link>
            </div>
          </div>
        </section>
      )}

      {detail.verdict && detail.verdict.breakdown.length > 0 && (
        <section className="mb-8">
          <h3 className="text-sm font-medium text-slate-300 mb-2">
            Verdict breakdown ({detail.verdict.breakdown.length} match
            {detail.verdict.breakdown.length === 1 ? "" : "es"} across{" "}
            {detail.verdict.matchedSchematicCount} schematic
            {detail.verdict.matchedSchematicCount === 1 ? "" : "s"})
          </h3>
          <p className="text-xs text-slate-400 mb-2">{detail.verdict.reason}</p>
          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Schematic</th>
                  <th className="px-3 py-2 text-left font-medium">Property</th>
                  <th className="px-3 py-2 text-left font-medium">Group</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Owned</th>
                  <th className="px-3 py-2 text-right font-medium">Δ</th>
                  <th className="px-3 py-2 text-center font-medium">Tier</th>
                </tr>
              </thead>
              <tbody>
                {detail.verdict.breakdown.map((m) => {
                  // Pre-Phase-4 persisted breakdowns may lack scoreOwned/tier;
                  // treat undefined as 0 / "SKIP" for graceful rendering until
                  // the next recompute writes the new shape.
                  const scoreOwned = m.scoreOwned ?? 0;
                  const delta = scoreOwned > 0 ? m.score - scoreOwned : null;
                  const tier = m.tier ?? "SKIP";
                  const tierCls =
                    tier === "CHASE"
                      ? "bg-emerald-900/60 border-emerald-700 text-emerald-200"
                      : tier === "MAYBE"
                        ? "bg-amber-900/50 border-amber-700 text-amber-200"
                        : "bg-slate-800 border-slate-700 text-slate-400";
                  return (
                    <tr
                      key={`${m.schematicId}-${m.propertyGroupId}`}
                      className="border-t border-slate-700 hover:bg-slate-800/50"
                    >
                      <td className="px-3 py-2">
                        <Link
                          to={`/schematics/${m.schematicId}`}
                          className="text-emerald-400 hover:text-emerald-300"
                        >
                          {m.schematicName}
                        </Link>
                        {m.inheritedFromParent && (
                          <span className="ml-2 text-[10px] text-slate-600 uppercase tracking-wide">
                            sub-component
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-200">{m.propertyName ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs font-mono">
                        {m.expGroup ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          m.score >= 85
                            ? "text-emerald-400 font-semibold"
                            : m.score >= 65
                              ? "text-amber-300"
                              : "text-slate-400"
                        }`}
                      >
                        {m.score.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                        {scoreOwned > 0 ? scoreOwned.toFixed(1) : <span className="text-slate-700">—</span>}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          delta === null
                            ? "text-slate-700"
                            : delta >= 3
                              ? "text-emerald-400"
                              : delta >= 0
                                ? "text-slate-400"
                                : "text-red-400"
                        }`}
                      >
                        {delta === null
                          ? "—"
                          : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${tierCls}`}
                        >
                          {tier}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detail.fitsActiveSchematics.length > 0 && (
        <section className="mb-8">
          <h3 className="text-sm font-medium text-slate-300 mb-2">
            Fits these active schematics ({detail.fitsActiveSchematics.length})
          </h3>
          <p className="text-xs text-slate-400 mb-2">
            Active schematics that have at least one raw-resource slot this resource type can fill.
            Independent of whether the verdict scored above threshold — even a SKIP resource may
            still fill a slot.
          </p>
          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Schematic</th>
                  <th className="px-3 py-2 text-left font-medium">Profession</th>
                  <th className="px-3 py-2 text-left font-medium">Matching slots</th>
                </tr>
              </thead>
              <tbody>
                {detail.fitsActiveSchematics.map((f) => (
                  <tr
                    key={f.schematicId}
                    className="border-t border-slate-700 hover:bg-slate-800/50"
                  >
                    <td className="px-3 py-2">
                      <Link
                        to={`/schematics/${f.schematicId}`}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        {f.schematicName}
                      </Link>
                      {f.inheritedFromParent && (
                        <span className="ml-2 text-[10px] text-slate-600 uppercase tracking-wide">
                          sub-component
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{f.profession ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-300 font-mono text-xs">
                      {f.matchingSlots.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!detail.verdict && detail.fitsActiveSchematics.length === 0 && character && (
        <p className="text-sm text-slate-500 italic">
          Doesn't fit any active schematic for {character.name}. Add a relevant schematic on the{" "}
          <Link to="/schematics" className="text-emerald-400 hover:text-emerald-300">
            Schematics
          </Link>{" "}
          page to score this resource.
        </p>
      )}

      {!character && (
        <p className="text-sm text-slate-500 italic">
          No active character — create one on the{" "}
          <Link to="/character" className="text-emerald-400 hover:text-emerald-300">
            Character
          </Link>{" "}
          page to enable verdicts and "fits these schematics."
        </p>
      )}
    </div>
  );
}
