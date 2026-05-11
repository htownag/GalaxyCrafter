// Pure scoring math — universal-bounds quality calculation.
//
// Given a resource's stat values and a property group's per-stat
// weights, compute the group's score as a percentage 0..100 against
// the universal 0-1000 stat range that the SWG experimentation
// formula uses.
//
//     score = 100 * Σ (w_i / Σw) * (stat_i / 1000)
//
// Why universal 0-1000 and not per-type cap/floor: SWG's in-game
// experimentation math uses raw stat values directly — a CD of 198
// produces less weapon damage than a CD of 932, regardless of how
// well each value performs within its own resource type's spawn
// range. The type-specific cap/floor is useful for "is this spawn
// a top specimen of its type?" (Resource Detail's stat bars), but
// it's the wrong scale for "which resource produces the best end
// item?" (verdict engine + Resource Finder ranking).
//
// The design doc §5.2.2 originally specified per-type pct-of-range
// but the §5.2.8 worked example used universal bounds — the example
// matched crafting reality; the formula in the prose did not. This
// implementation matches the example. See design-report.md errata.
//
// Returns `null` if any weighted stat is missing on the resource
// (filtered out per Phase 3 NULL-stat-semantics decision).

import type { StatKey } from "@shared/ipc-types";
import type { ResourceStats, StatWeight } from "./types";

/** Theoretical stat ceiling that SWG resources can roll. */
export const UNIVERSAL_STAT_MAX = 1000;

/**
 * Compute one property-group score for one resource.
 *
 * @returns Score in [0, 100], or `null` if the resource is missing any
 *          stat the property group weights.
 */
export function scoreGroup(
  stats: ResourceStats,
  weights: StatWeight[],
): number | null {
  if (weights.length === 0) return null; // un-scoreable (derived property, no weights)

  let weightSum = 0;
  for (const w of weights) weightSum += w.weight;
  if (weightSum <= 0) return null; // weightTotal = 0 → derived property group

  let weightedPct = 0;
  for (const w of weights) {
    const stat = w.stat as StatKey;
    const v = stats[stat];
    if (v === null || v === undefined) return null; // missing weighted stat
    weightedPct += (w.weight / weightSum) * (v / UNIVERSAL_STAT_MAX);
  }

  return weightedPct * 100;
}
