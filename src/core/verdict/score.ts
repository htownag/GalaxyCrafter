// Pure scoring math — the standard SWG quality-percentage formula.
//
// Given a resource's stat values, the resource type's caps/floors, and a
// property group's per-stat weights, compute the group's score as a
// percentage 0..100.
//
//     pct_of_range(stat) = (resource.stat - floor) / (cap - floor)
//     score              = 100 * Σ (w_i / Σw) * pct_of_range(stat_i)
//
// Returns `null` if any weighted stat is missing on the resource (filtered
// out per Phase 3 NULL-stat-semantics decision).

import type { StatKey } from "@shared/ipc-types";
import type { ResourceStats, StatBounds, StatWeight } from "./types";

/**
 * Compute one property-group score for one resource.
 *
 * @returns Score in [0, 100], or `null` if the resource is missing any
 *          stat the property group weights.
 */
export function scoreGroup(
  stats: ResourceStats,
  caps: StatBounds,
  floors: StatBounds,
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

    const cap = caps[stat] ?? 0;
    const floor = floors[stat] ?? 0;
    const range = cap - floor;

    // Type doesn't roll this stat (cap == floor). pct treats as 0 — the
    // resource literally cannot vary on this dimension. This deliberately
    // *underscores* the resource for that group; the alternative (pct=1)
    // would falsely flag every spawn as a peg-hit.
    const pct = range > 0 ? (v - floor) / range : 0;

    weightedPct += (w.weight / weightSum) * pct;
  }

  return weightedPct * 100;
}
