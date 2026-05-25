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
// Missing/null stats are treated as 0 — matches Core3's
// `SharedLabratory::getWeightedValue` exactly:
//
//   if (stat != 0) { nsum += n; weightedAverage += stat * n; }
//
// Before v0.1.5 this function returned `null` on any missing weighted stat,
// which filtered the resource out of the verdict + finder + crafting-plan
// entirely. That was an over-strict Phase 3 choice — Core3 doesn't filter,
// it just scores the resource lower because the missing stat contributes 0
// to the weighted sum. Real-world cost: chemicals (which can't roll SR/UT
// on some types) were invisible in armor + power-handler crafts where
// they're the only allowed resource family. With null-as-0, those
// resources score honestly low (matching the in-game craft cap) but stay
// visible so the player can rank within their family.
//
// Returns `null` only when the property group itself is unscoreable
// (no weights or all-zero weights — a derived attribute group).

import type { StatKey } from "@shared/ipc-types";
import type { ResourceStats, StatWeight } from "./types";

/** Theoretical stat ceiling that SWG resources can roll. */
export const UNIVERSAL_STAT_MAX = 1000;

/**
 * Compute one property-group score for one resource.
 *
 * @returns Score in [0, 100], or `null` only if the property group itself
 *          carries no weights (i.e. it's a derived attribute group that
 *          doesn't depend on resource stats). Resources missing one or more
 *          weighted stats still get a score — those stats contribute 0,
 *          matching Core3's `getWeightedValue` math.
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
    // Missing/null treated as 0 — Core3 parity. Resource is penalised but
    // not filtered out, preserving the player's ability to rank within a
    // resource family that can't roll every weighted stat.
    const v = stats[stat] ?? 0;
    weightedPct += (w.weight / weightSum) * (v / UNIVERSAL_STAT_MAX);
  }

  return weightedPct * 100;
}
