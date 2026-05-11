// Shared input/output types for the verdict-scoring pipeline.
//
// Kept dependency-free of the renderer / IPC / DB layers so the math is
// trivially unit-testable. The orchestrator (`recompute.ts`) is the only
// module here that talks to Drizzle.

import type { StatKey } from "@shared/ipc-types";

/**
 * Per-stat weight in a property group. Weights are raw integers as imported
 * from GH's `tSchematicResWeights.txt`; normalisation by the property
 * group's `weightTotal` (or `Σ weights`, equivalent) happens inside the
 * scoring function.
 */
export interface StatWeight {
  stat: string; // 'OQ' | 'CD' | 'SR' | ... — narrow to StatKey at the rollup boundary
  weight: number;
}

/**
 * Per-resource stat values. `null` = the resource's type doesn't roll that
 * stat (e.g. inorganic resources have no PE/FL). The scorer filters groups
 * whose weighted stats are missing.
 */
export type ResourceStats = Record<StatKey, number | null>;

// (StatBounds type removed in Phase 5 — universal-bounds scoring doesn't
// need per-type cap/floor as scoring inputs. Resource Detail still
// surfaces type caps for stat-bar visualisation, sourced directly from
// resource_types rows on a per-page basis.)

/**
 * Single schematic+property-group match result. `null` weights mean the
 * group was unscoreable (resource is missing one of the weighted stats).
 *
 * Phase 4 added `scoreOwned` (the character's best-owned score for the
 * same (schematic, propertyGroup) tuple — 0 when the user owns nothing
 * of compatible type) and the per-match `tier` derived from the §5.2.5
 * dichotomy. The roll-up then takes the max tier across matches.
 */
export interface ScoredMatch {
  schematicId: string;
  schematicName: string;
  propertyGroupId: number;
  propertyName: string | null;
  expGroup: string | null;
  score: number; // 0..100
  scoreOwned: number; // 0..100; 0 = own nothing compatible
  tier: "CHASE" | "MAYBE" | "SKIP";
  inheritedFromParent: boolean;
}

/**
 * Final per-resource verdict (one row written to `verdicts` table per
 * resource × character × snapshot).
 */
export interface ResourceVerdict {
  tier: "CHASE" | "MAYBE" | "SKIP";
  reason: string;
  topScore: number;
  matchedSchematicCount: number;
  /** All (schematic, property-group, score) tuples; serialised to JSON for drill-down. */
  breakdown: ScoredMatch[];
}
