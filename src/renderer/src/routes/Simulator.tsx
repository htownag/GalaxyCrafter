import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ActiveSchematicEntry,
  SchematicSummary,
  SimulatorPredictResult,
  SimulatorSkillProfile,
} from "@shared/ipc-types";
import { useActiveCharacter } from "../hooks/useActiveCharacter";

// Phase 6 v1 — Crafting simulator.
//
// "Given this schematic, hypothetical perfect resources, and a skill profile,
// what's the ceiling craftingValues map?" That's the v1 answer. Future
// versions will swap hypothetical-perfect for actual slot choice from
// inventory/spawns + per-row experimentation strategy + A/B comparison.

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

  // Load active list (preferred scope) + a smaller "all" fallback for search.
  useEffect(() => {
    if (!character) return;
    void window.api.listActiveSchematics(character.id).then((rows) => {
      setActiveList(rows);
      if (!schematicId && rows.length > 0) setSchematicId(rows[0].schematicId);
    });
    void window.api.listSchematics({ query: searchQuery || undefined }).then(setAllSchematics);
  }, [character, searchQuery, schematicId]);

  const run = useCallback(async () => {
    if (!schematicId) return;
    setLoading(true);
    try {
      const res = await window.api.predictManufacture({
        schematicId,
        slotConfig: "hypothetical_perfect",
        skillProfile: profile,
        assemblyTier,
      });
      setResult(res);
    } finally {
      setLoading(false);
    }
  }, [schematicId, profile, assemblyTier]);

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
                <div className="overflow-x-auto rounded-md border border-slate-700">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-800 text-slate-300">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">Property</th>
                        <th className="px-2 py-2 text-left font-medium">Group</th>
                        <th className="px-2 py-2 text-left font-medium">Weights</th>
                        <th className="px-2 py-2 text-right font-medium" title="Σ stat × percentage, 0..1000">
                          Weighted sum
                        </th>
                        <th className="px-2 py-2 text-right font-medium" title="weightedSum / 10. Ceiling.">
                          Max %
                        </th>
                        <th className="px-2 py-2 text-right font-medium" title="getAssemblyPercentage × tier modifier">
                          Start %
                        </th>
                        <th className="px-2 py-2 text-right font-medium" title="Start + all exp points at GREATSUCCESS, clamped to Max">
                          Focused %
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.propertyGroups
                        .filter((g) => g.weightedSum > 0)
                        .map((g) => (
                          <tr key={g.id} className="border-t border-slate-700 hover:bg-slate-900/50">
                            <td className="px-2 py-1.5 text-slate-100">
                              {g.propertyName ?? "—"}
                            </td>
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
                            <td className="px-2 py-1.5 text-right tabular-nums text-emerald-300 font-medium">
                              {g.focusedPercent.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
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
