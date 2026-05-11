import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ActiveSchematicEntry,
  ResourceStats,
  SchematicSummary,
  SimulatorPredictedGroup,
  SimulatorPredictResult,
  SimulatorSkillProfile,
  SimulatorSlotChoice,
  SimulatorSlotInfo,
  StatKey,
} from "@shared/ipc-types";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

// Phase 6 v1.1 — Crafting simulator with per-slot resource picker.
//
// Pick a schematic; for each raw slot, pick a resource from your inventory or
// current spawns (or leave on "hypothetical perfect" for ceiling reads). The
// simulator runs the actual SwoGEmu/Core3 math on your chosen mix and shows
// per-property-group predicted values.

const ASSEMBLY_TIER_LABELS: Record<number, string> = {
  0: "Amazing Success (×1.05)",
  1: "Great Success (×1.00)",
  2: "Good Success (×0.90)",
  3: "Moderate Success (×0.80)",
  4: "Success (×0.70)",
  5: "Marginal Success (×0.60)",
  6: "OK (×0.50)",
  7: "Barely Successful (×0.40)",
};

const DEFAULT_PROFILE: SimulatorSkillProfile = {
  assemblySkill: 110,
  experimentationSkill: 110,
  toolEffectiveness: 15,
};

export function Simulator(): JSX.Element {
  const { character } = useActiveCharacter();
  const [activeList, setActiveList] = useState<ActiveSchematicEntry[]>([]);
  const [allSchematics, setAllSchematics] = useState<SchematicSummary[]>([]);
  const [schematicId, setSchematicId] = useState<string | null>(null);
  const [profile, setProfile] = useState<SimulatorSkillProfile>(DEFAULT_PROFILE);
  const [assemblyTier, setAssemblyTier] = useState(1); // GREATSUCCESS
  const [result, setResult] = useState<SimulatorPredictResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  // Per-slot resource choices. Keyed by schematicId|slotName so swapping
  // schematics doesn't drag the previous schematic's picks along.
  const [slotChoices, setSlotChoices] = useState<Record<string, SimulatorSlotChoice>>({});

  // Load active list (preferred scope) + a smaller "all" fallback for search.
  useEffect(() => {
    if (!character) return;
    void window.api.listActiveSchematics(character.id).then((rows) => {
      setActiveList(rows);
      if (!schematicId && rows.length > 0) setSchematicId(rows[0].schematicId);
    });
    void window.api.listSchematics({ query: searchQuery || undefined }).then(setAllSchematics);
  }, [character, searchQuery, schematicId]);

  // Filter slotChoices to just the keys for the active schematic.
  const activeSlotChoices = useMemo(() => {
    if (!schematicId) return {};
    const out: Record<string, SimulatorSlotChoice> = {};
    const prefix = `${schematicId}|`;
    for (const [k, v] of Object.entries(slotChoices)) {
      if (k.startsWith(prefix)) {
        out[k.slice(prefix.length)] = v;
      }
    }
    return out;
  }, [slotChoices, schematicId]);

  const run = useCallback(async () => {
    if (!schematicId) return;
    setLoading(true);
    try {
      const res = await window.api.predictManufacture({
        schematicId,
        slotChoices: activeSlotChoices,
        skillProfile: profile,
        assemblyTier,
      });
      setResult(res);
    } finally {
      setLoading(false);
    }
  }, [schematicId, profile, assemblyTier, activeSlotChoices]);

  function setSlotChoice(slotName: string, choice: SimulatorSlotChoice): void {
    if (!schematicId) return;
    const key = `${schematicId}|${slotName}`;
    setSlotChoices((prev) => ({ ...prev, [key]: choice }));
  }

  useEffect(() => {
    const t = setTimeout(() => void run(), 100);
    return () => clearTimeout(t);
  }, [run]);

  // Build a flat schematic list for the picker: active first, then search results.
  const schematicOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string; tag: string }> = [];
    for (const a of activeList) {
      if (seen.has(a.schematicId)) continue;
      seen.add(a.schematicId);
      out.push({ id: a.schematicId, name: a.schematicName, tag: "active" });
    }
    for (const s of allSchematics) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, name: s.name, tag: "all" });
      if (out.length > 50) break;
    }
    return out;
  }, [activeList, allSchematics]);

  if (!character) {
    return (
      <div className="p-6 text-slate-400">
        No active character.{" "}
        <Link to="/character" className="text-emerald-400 hover:text-emerald-300">
          Create one
        </Link>{" "}
        to use the simulator.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-100">Crafting simulator</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Predicted manufacturing-schematic values for {character.name}. v1 assumes a
          hypothetical perfect resource set (all stats = 1000) to show the schematic's ceiling.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Left pane: inputs */}
        <div className="space-y-4">
          <div className="rounded-md border border-slate-700 bg-slate-900 p-3">
            <h3 className="text-xs font-medium text-slate-300 mb-2">Schematic</h3>
            <input
              type="text"
              placeholder="Search all schematics…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full mb-2 px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-600"
            />
            <select
              value={schematicId ?? ""}
              onChange={(e) => setSchematicId(e.target.value || null)}
              className="w-full px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700 text-slate-100"
            >
              {schematicOptions.length === 0 && <option value="">No matches</option>}
              {schematicOptions.length > 0 && (
                <>
                  <optgroup label="Active list">
                    {schematicOptions
                      .filter((o) => o.tag === "active")
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="All schematics">
                    {schematicOptions
                      .filter((o) => o.tag === "all")
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </optgroup>
                </>
              )}
            </select>
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-900 p-3 space-y-2">
            <h3 className="text-xs font-medium text-slate-300 mb-1">Skill profile</h3>
            <SkillNumber
              label="Assembly skill"
              value={profile.assemblySkill}
              onChange={(v) => setProfile({ ...profile, assemblySkill: v })}
            />
            <SkillNumber
              label="Experimentation skill"
              value={profile.experimentationSkill}
              onChange={(v) => setProfile({ ...profile, experimentationSkill: v })}
            />
            <SkillNumber
              label="Tool effectiveness"
              value={profile.toolEffectiveness}
              min={-15}
              max={15}
              onChange={(v) => setProfile({ ...profile, toolEffectiveness: v })}
            />
            <p className="text-[11px] text-slate-500 mt-2 leading-tight">
              Master-crafter defaults. Tool eff +15 = best private tool. v1 uses these for the
              experimentation point budget; tool eff affects future Monte Carlo work, not
              ceiling reads.
            </p>
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-900 p-3">
            <h3 className="text-xs font-medium text-slate-300 mb-1">Assembly tier (assumed)</h3>
            <select
              value={assemblyTier}
              onChange={(e) => setAssemblyTier(Number(e.target.value))}
              className="w-full px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700 text-slate-100"
            >
              {Object.entries(ASSEMBLY_TIER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-2 leading-tight">
              Players typically reroll until Great Success or better; default of GS reflects
              normal best-effort play.
            </p>
          </div>

          {result && result.slots.length > 0 && (
            <div className="rounded-md border border-slate-700 bg-slate-900 p-3 space-y-2">
              <h3 className="text-xs font-medium text-slate-300 mb-1">
                Resource slots ({result.slots.length})
              </h3>
              <p className="text-[11px] text-slate-500 leading-tight mb-2">
                Pick per slot. "Perfect" assumes a 1000-stat hypothetical for
                ceiling reads. Owned + spawning resources that fit each slot's
                type appear in their respective groups.
              </p>
              {result.slots.map((slot) => (
                <SlotPicker
                  key={slot.slotName}
                  slot={slot}
                  relevantStats={result.relevantStats}
                  onChange={(c) => setSlotChoice(slot.slotName, c)}
                />
              ))}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-slate-700 bg-slate-900 p-3 text-xs text-slate-300 space-y-1">
              <h3 className="text-xs font-medium text-slate-300 mb-1">Context</h3>
              <div>
                <span className="text-slate-500">Profession:</span>{" "}
                {result.schematic.profession ?? "—"}
              </div>
              <div>
                <span className="text-slate-500">Complexity:</span>{" "}
                {result.schematic.complexity ?? "—"}
              </div>
              <div>
                <span className="text-slate-500">Exp points:</span>{" "}
                {result.assumptions.experimentationPointBudget}
              </div>
              <div>
                <span className="text-slate-500">Slot fill:</span>{" "}
                <span
                  className={
                    result.slotConfigSummary === "perfect"
                      ? "text-amber-300"
                      : "text-emerald-300"
                  }
                >
                  {result.slotConfigSummary === "perfect"
                    ? "All hypothetical perfect (ceiling)"
                    : "Mixed real / hypothetical"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right pane: predicted property groups */}
        <div>
          {loading && !result && <p className="text-slate-400">Loading…</p>}

          {result && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-medium text-slate-100">{result.schematic.name}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Assuming hypothetical perfect resources (every stat = 1000).
                  Real resource yields will be lower in proportion to actual stats.
                </p>
              </div>

              {result.propertyGroups.length === 0 && (
                <p className="text-slate-400 text-sm">This schematic has no property groups.</p>
              )}

              {result.propertyGroups.some((g) => g.weightedSum > 0) && (
                <FinalStatsPanel groups={result.propertyGroups.filter((g) => g.weightedSum > 0)} />
              )}

              {result.propertyGroups.some((g) => g.weightedSum > 0) && (
                <CalculationDetailsPanel groups={result.propertyGroups.filter((g) => g.weightedSum > 0)} />
              )}

              {result.propertyGroups.some((g) => g.weightedSum === 0 && g.weights.length === 0) && (
                <div>
                  <h4 className="text-xs font-medium text-slate-400 mb-1">Non-scoreable groups</h4>
                  <p className="text-[11px] text-slate-500">
                    {result.propertyGroups
                      .filter((g) => g.weightedSum === 0 && g.weights.length === 0).length}{" "}
                    derived property group(s) — not affected by resource quality.
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="mt-8 text-[11px] text-slate-600 leading-snug">
            Simulator uses vanilla Core3 formulas. Your server may apply small balance tweaks
            (SR2 applies a +5% experimentation roll bonus, a per-schematic armor belt skip, and
            a Patch-K DOT-component path — see docs/crafting-math.md §11). Predicted output is
            a baseline, not a server-exact figure.
          </p>
        </div>
      </div>
    </div>
  );
}

function SkillNumber({
  label,
  value,
  onChange,
  min = 0,
  max = 120,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-slate-300">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-20 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-100 text-right"
      />
    </label>
  );
}

const HYPOTHETICAL_VALUE = "__perfect__";
const MANUAL_VALUE = "__manual__";

function SlotPicker({
  slot,
  relevantStats,
  onChange,
}: {
  slot: SimulatorSlotInfo;
  relevantStats: StatKey[];
  onChange: (choice: SimulatorSlotChoice) => void;
}): JSX.Element {
  const selectedValue =
    slot.chosen.type === "resource"
      ? slot.chosen.resourceId
      : slot.chosen.type === "manual"
        ? MANUAL_VALUE
        : HYPOTHETICAL_VALUE;

  function handleChange(v: string): void {
    if (v === HYPOTHETICAL_VALUE) {
      onChange({ type: "hypothetical_perfect" });
    } else if (v === MANUAL_VALUE) {
      // Preserve existing manual stats if we're already in manual mode;
      // otherwise start with empty (zero) entries.
      const stats = slot.chosen.type === "manual" ? slot.chosen.stats : {};
      onChange({ type: "manual", stats });
    } else {
      onChange({ type: "resource", resourceId: v });
    }
  }

  const ownedCount = slot.ownedOptions.length;
  const spawnCount = slot.spawnOptions.length;
  const showOwned = !slot.isSubComponent && ownedCount > 0;
  const showSpawn = !slot.isSubComponent && spawnCount > 0;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-slate-200">
          {humanSlotName(slot.slotName)}
          {slot.isSubComponent && (
            <span className="ml-1 text-[10px] text-slate-500 font-normal">
              (sub-component)
            </span>
          )}
        </span>
        <span
          className="text-[10px] font-mono text-slate-500 truncate max-w-[180px]"
          title={`Accepts ${slot.ingredientObject}. Needs ${slot.unitsRequired} units.`}
        >
          {slot.unitsRequired}u · {shortRef(slot.ingredientObject)}
        </span>
      </div>
      <select
        value={selectedValue}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full px-2 py-1 text-xs rounded bg-slate-800 border border-slate-700 text-slate-100"
      >
        {!slot.isSubComponent && (
          <option value={HYPOTHETICAL_VALUE}>
            Hypothetical perfect (1000 stats)
          </option>
        )}
        {slot.isSubComponent && (
          <option value={MANUAL_VALUE}>Manual stat entry</option>
        )}
        {showOwned && (
          <optgroup label={`Owned (${ownedCount})`}>
            {slot.ownedOptions.map((o) => (
              <option key={`o-${o.resourceId}`} value={o.resourceId}>
                {o.resourceName} {o.oq !== null ? `· OQ ${o.oq}` : ""}
                {o.ownedUnits ? ` · ${o.ownedUnits.toLocaleString()} on hand` : ""}
              </option>
            ))}
          </optgroup>
        )}
        {showSpawn && (
          <optgroup label={`Currently spawning (${spawnCount})`}>
            {slot.spawnOptions.map((o) => (
              <option key={`s-${o.resourceId}`} value={o.resourceId}>
                {o.resourceName} {o.oq !== null ? `· OQ ${o.oq}` : ""}
              </option>
            ))}
          </optgroup>
        )}
        {!slot.isSubComponent && (
          <option value={MANUAL_VALUE}>Manual stat entry</option>
        )}
        {!slot.isSubComponent && ownedCount === 0 && spawnCount === 0 && (
          <option disabled value="">— no matching resources known —</option>
        )}
      </select>

      {slot.chosen.type === "manual" && (
        <ManualStatPanel
          stats={slot.chosen.stats}
          relevantStats={relevantStats}
          onChange={(stats) => onChange({ type: "manual", stats })}
        />
      )}
    </div>
  );
}

function ManualStatPanel({
  stats,
  relevantStats,
  onChange,
}: {
  stats: Partial<ResourceStats>;
  relevantStats: StatKey[];
  onChange: (next: Partial<ResourceStats>) => void;
}): JSX.Element {
  // Display only stats this parent schematic actually weights. If the parent
  // weighs no stats (e.g. a non-scoreable schematic), fall back to "show all
  // 10" so the user has somewhere to type.
  const shown: StatKey[] =
    relevantStats.length > 0
      ? relevantStats
      : ["OQ", "CR", "CD", "DR", "FL", "HR", "MA", "PE", "SR", "UT"];

  function setOne(stat: StatKey, raw: string): void {
    const n = raw === "" ? undefined : Math.max(0, Math.min(1000, Number(raw) || 0));
    const next = { ...stats };
    if (n === undefined) {
      delete next[stat];
    } else {
      next[stat] = n;
    }
    onChange(next);
  }

  function reset(value: number): void {
    const next: Partial<ResourceStats> = {};
    if (value > 0) {
      for (const s of shown) next[s] = value;
    }
    onChange(next);
  }

  return (
    <div className="mt-2 p-2 rounded border border-slate-700/60 bg-slate-950">
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {shown.map((s) => (
          <label
            key={s}
            className="flex items-center justify-between gap-1 text-[10px] text-slate-300"
          >
            <span className="font-mono text-slate-400 w-6">{s}</span>
            <input
              type="number"
              min={0}
              max={1000}
              placeholder="0"
              value={stats[s] ?? ""}
              onChange={(e) => setOne(s, e.target.value)}
              className="w-16 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-100 text-right text-[11px]"
            />
          </label>
        ))}
      </div>
      <div className="flex gap-1.5 text-[10px]">
        <button
          type="button"
          onClick={() => reset(0)}
          className="px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
        >
          Reset to 0
        </button>
        <button
          type="button"
          onClick={() => reset(1000)}
          className="px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
        >
          Fill 1000
        </button>
      </div>
      {relevantStats.length === 0 && (
        <p className="text-[10px] text-slate-500 mt-1 leading-tight">
          This schematic doesn't weight any stats — manual entry is shown for
          reference only.
        </p>
      )}
    </div>
  );
}

/** Trim a long IFF path to its final filename for tight display. */
function shortRef(s: string): string {
  if (!s.includes("/")) return s;
  const last = s.split("/").pop() ?? s;
  return last.replace(/\.iff$/, "");
}

/** Title-case + de-snake the in-engine property name for display.
 *  mindamage -> Min Damage, attackhealthcost -> Attack Health Cost. */
function humanProperty(name: string | null): string {
  if (!name) return "—";
  const splits: Record<string, string> = {
    mindamage: "Min Damage",
    maxdamage: "Max Damage",
    attackspeed: "Attack Speed",
    woundchance: "Wound Chance",
    hitpoints: "Hit Points",
    zerorangemod: "Zero-Range Mod",
    midrangemod: "Mid-Range Mod",
    maxrangemod: "Max-Range Mod",
    midrange: "Mid Range",
    maxrange: "Max Range",
    attackhealthcost: "Health Cost / Attack",
    attackactioncost: "Action Cost / Attack",
    attackmindcost: "Mind Cost / Attack",
    armor_effectiveness: "Armor Effectiveness",
    armor_health_encumbrance: "Health Encumbrance",
    armor_action_encumbrance: "Action Encumbrance",
    armor_mind_encumbrance: "Mind Encumbrance",
    extractrate: "Extraction Rate (BER)",
    hoppersize: "Hopper Size",
    decayRate: "Decay Rate",
  };
  if (splits[name]) return splits[name];
  // Fallback: title case the words
  return name
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a number with N decimal places, then trim trailing zeros if dec>0. */
function fmtValue(v: number | null, precision: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const p = Math.max(0, precision ?? 0);
  return v.toFixed(p);
}

function FinalStatsPanel({
  groups,
}: {
  groups: SimulatorPredictedGroup[];
}): JSX.Element {
  const withRanges = groups.filter((g) => g.expMin !== null && g.expMax !== null);
  const noRanges = groups.length > 0 && withRanges.length === 0;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-sm font-medium text-slate-200">Predicted final item stats</h4>
        <span className="text-[11px] text-slate-500">
          Real in-game values (interpolated by focused %)
        </span>
      </div>

      {noRanges && (
        <p className="text-[11px] text-slate-500 mb-2">
          No experimental range data joined for this schematic — only percentage-of-cap
          predictions are available below.
        </p>
      )}

      {withRanges.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Property</th>
                <th className="px-2 py-2 text-right font-medium" title="Authored min..max from the SR2 template Lua. When min > max, lower is better.">
                  Range
                </th>
                <th className="px-2 py-2 text-right font-medium" title="Value right after assembly, pre-experimentation.">
                  Start
                </th>
                <th className="px-2 py-2 text-right font-medium" title="Value if all experimentation points dump on this row (ceiling-if-focused).">
                  Focused
                </th>
                <th className="px-2 py-2 text-right font-medium">% of max</th>
              </tr>
            </thead>
            <tbody>
              {withRanges.map((g) => (
                <tr key={g.id} className="border-t border-slate-700 hover:bg-slate-900/50">
                  <td className="px-2 py-1.5">
                    <span className="text-slate-100">{humanProperty(g.propertyName)}</span>
                    {g.inverted && (
                      <span
                        className="ml-1.5 text-[10px] font-mono text-amber-400"
                        title="Lower is better"
                      >
                        ↓
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-400 text-xs">
                    {fmtValue(g.expMin, g.expPrecision)}..{fmtValue(g.expMax, g.expPrecision)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-amber-300">
                    {fmtValue(g.startingValue, g.expPrecision)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-emerald-300 font-medium">
                    {fmtValue(g.focusedValue, g.expPrecision)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500 text-xs">
                    {g.focusedPercent.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CalculationDetailsPanel({
  groups,
}: {
  groups: SimulatorPredictedGroup[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-md border border-slate-700 bg-slate-900 overflow-hidden"
      open={open}
    >
      <summary
        className="cursor-pointer select-none px-3 py-2 text-xs text-slate-400 hover:text-slate-200"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        Calculation details (weighted sum, max %, start %, focused %)
      </summary>
      {open && (
        <div className="border-t border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Property</th>
                <th className="px-2 py-2 text-left font-medium">Group</th>
                <th className="px-2 py-2 text-left font-medium">Weights</th>
                <th className="px-2 py-2 text-right font-medium">Weighted sum</th>
                <th className="px-2 py-2 text-right font-medium">Max %</th>
                <th className="px-2 py-2 text-right font-medium">Start %</th>
                <th className="px-2 py-2 text-right font-medium">Focused %</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className="border-t border-slate-700">
                  <td className="px-2 py-1.5 text-slate-100">{humanProperty(g.propertyName)}</td>
                  <td className="px-2 py-1.5 text-slate-400 text-xs font-mono">
                    {g.expGroup ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-[11px] text-slate-400">
                    {g.weights.map((w) => `${w.stat}×${w.weight}`).join(" ")}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
                    {Math.round(g.weightedSum)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
                    {g.maxPercent.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-amber-300">
                    {g.startingPercent.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-emerald-300">
                    {g.focusedPercent.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

/** Human-format a slot key like "frame_assembly" → "Frame Assembly". */
function humanSlotName(s: string): string {
  return s
    .split(/[_\s]+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
