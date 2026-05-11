// Assembly stage formulas — §4 of docs/crafting-math.md.
//
// Mirrors:
//   getAssemblyPercentage     (SharedLabratory.cpp:68)
//   calculateAssemblyValueModifier (SharedLabratory.cpp:59)
//
// Together these compute the starting percentage after the player clicks
// "Assemble" — the value experimentation builds on. Tier of the assembly
// roll is an input (we don't simulate the roll itself in v1 — players
// reroll until they get a good assembly).

import { ASSEMBLY_TIER, type AssemblyTier } from "./types";

/**
 * Quadratic-in-`value` starting-percentage curve.
 *
 *   percentage = (value × (0.000015 × value + 0.015)) × 0.01
 *
 * Values from the §4 sample table:
 *   weightedSum=100  →  1.65%
 *   weightedSum=500  → 11.25%
 *   weightedSum=940  → 27.35%
 *   weightedSum=1000 → 30.00%
 */
export function getAssemblyPercentage(value: number): number {
  return value * (0.000015 * value + 0.015) * 0.01;
}

/**
 * Tier-to-modifier table for the assembly outcome.
 *
 * AMAZINGSUCCESS gets a hardcoded 1.05 bonus; everything else follows the
 * linear formula `1.1 - tier × 0.1`. Anything above BARELYSUCCESSFUL (i.e.
 * CRITICALFAILURE = 8) falls below 0.4 — Core3 wraps the assembly path's
 * critical-failure branch in a `//return CRITICALFAILURE;` comment, so in
 * practice this isn't reachable on assembly, but we keep the formula
 * consistent.
 */
export function calculateAssemblyValueModifier(tier: AssemblyTier): number {
  if (tier === ASSEMBLY_TIER.AMAZINGSUCCESS) return 1.05;
  return 1.1 - tier * 0.1;
}

/**
 * Starting percentage for a property group:
 *   percentage = getAssemblyPercentage(weightedSum) × modifier(tier)
 */
export function startingPercent(weightedSum: number, tier: AssemblyTier): number {
  return getAssemblyPercentage(weightedSum) * calculateAssemblyValueModifier(tier);
}
