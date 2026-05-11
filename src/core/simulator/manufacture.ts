// Manufacture orchestrator — pulls §3 (weighted values) + §4 (assembly) + §5c
// (experimentation) together to predict a schematic's craftingValues map.
//
// v1 simplification: every property group is computed independently with
// "all points dumped here" — the ceiling-if-focused number. Future
// versions will accept a per-group point allocation strategy.

import { startingPercent } from "./assembly";
import { focusedExperimentation } from "./experiment";
import {
  ASSEMBLY_TIER,
  DEFAULT_SKILL_PROFILE,
  type AssemblyTier,
  type PredictedPropertyGroup,
  type PropertyGroupInput,
  type SkillProfile,
  type SlotFill,
} from "./types";
import { getWeightedValue } from "./values";

export interface PredictSchematicArgs {
  propertyGroups: PropertyGroupInput[];
  slots: SlotFill[];
  skillProfile?: SkillProfile;
  assemblyTier?: AssemblyTier;
}

export interface PredictSchematicResult {
  propertyGroups: PredictedPropertyGroup[];
  /** experimentationSkill / 10 — total points the player has to spend. */
  experimentationPointBudget: number;
}

/**
 * Per-group prediction:
 *   weightedSum   = Σ_stats (getWeightedValue(stat) × weight_pct)
 *   maxPercent    = weightedSum / 10
 *   startingPct   = getAssemblyPercentage(weightedSum) × modifier(tier)
 *   focusedPct    = startingPct + 0.07 × budget  (clamped to maxPercent,
 *                                                 GREATSUCCESS tier)
 *
 * `weight_pct` is the weight's share of the group's total weight — Core3
 * sums to 1.0 across the group (the doc's "propertyPercentage" field).
 */
export function predictSchematic(args: PredictSchematicArgs): PredictSchematicResult {
  const profile = args.skillProfile ?? DEFAULT_SKILL_PROFILE;
  const assemblyTier = args.assemblyTier ?? ASSEMBLY_TIER.GREATSUCCESS;
  const expBudget = Math.floor(profile.experimentationSkill / 10);

  const groups: PredictedPropertyGroup[] = args.propertyGroups.map((g) => {
    const totalWeight = g.weights.reduce((s, w) => s + w.weight, 0);
    if (totalWeight === 0) {
      // Non-scoreable group (no weights). Echo it back with zeros so callers
      // can still list it.
      return {
        id: g.id,
        propertyName: g.propertyName,
        expGroup: g.expGroup,
        weights: g.weights,
        weightedSum: 0,
        maxPercent: 0,
        startingPercent: 0,
        focusedPercent: 0,
      };
    }

    let weightedSum = 0;
    for (const w of g.weights) {
      const pct = w.weight / totalWeight;
      weightedSum += getWeightedValue(w.stat, args.slots) * pct;
    }

    const maxPct = weightedSum / 10; // weightedSum/1000 × 100
    const start = startingPercent(weightedSum, assemblyTier) * 100; // 0..1 → 0..100
    const focused = focusedExperimentation(start / 100, maxPct / 100, expBudget) * 100;

    return {
      id: g.id,
      propertyName: g.propertyName,
      expGroup: g.expGroup,
      weights: g.weights,
      weightedSum,
      maxPercent: maxPct,
      startingPercent: start,
      focusedPercent: focused,
    };
  });

  return {
    propertyGroups: groups,
    experimentationPointBudget: expBudget,
  };
}
