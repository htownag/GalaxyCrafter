// Per-resource verdict rollup.
//
// Phase 4 introduces the design doc §5.2.5 delta-vs-owned formula on a
// per-match basis. Each (schematic, property-group) match gets its own
// tier; the resource-level tier is the max across matches.
//
// Two paths, dichotomy on `scoreOwned`:
//
//   scoreOwned == 0 (own nothing of compatible type)
//     CHASE if score >= ABS_CHASE_THRESHOLD (85)
//     MAYBE if score >= ABS_MAYBE_THRESHOLD (65)
//     SKIP  otherwise
//
//   scoreOwned > 0
//     delta = score - scoreOwned
//     CHASE if delta >= DELTA_CHASE (8)
//     CHASE if score >= HIGH_SCORE_CHASE_FLOOR (90) AND delta >= DELTA_MAYBE (3)
//     MAYBE if delta >= DELTA_MAYBE (3)
//     MAYBE if score >= HIGH_SCORE_MAYBE_FLOOR (85)
//     SKIP  otherwise
//
// Why a dichotomy rather than per-rule floors (per advisor): a literal
// reading of §5.2.5 with empty inventory makes every active-list match
// fire one of the CHASE rules (score_owned=0 trivially satisfies "delta
// >= 8 AND profession match" since delta == score, and the active list
// already filters by profession). That flood is not useful. The
// dichotomy makes empty inventory degenerate cleanly to Phase 3's
// absolute thresholds, and turns on the delta logic only after the user
// owns at least one compatible-type resource.
//
// Profession-priority gating (§5.2.5 rule 2's "AND profession in
// priority_set") is intentionally not implemented as a separate gate:
// the user's active schematic list IS the curated priority list, so
// scoring against it does the filter implicitly.

import type { ResourceVerdict, ScoredMatch } from "./types";

/** Tunable verdict thresholds. The defaults preserve the Phase 3 baseline
 *  as the regression contract; user overrides flow through from the
 *  settings page via `recompute.ts`. */
export interface VerdictThresholds {
  /** Empty-inventory absolute CHASE floor. */
  absChase: number;
  /** Empty-inventory absolute MAYBE floor. */
  absMaybe: number;
  /** Owned-inventory delta floor for CHASE. */
  deltaChase: number;
  /** Owned-inventory delta floor for MAYBE. */
  deltaMaybe: number;
  /** Score floor for CHASE on the delta-path (when delta is between
   *  deltaMaybe and deltaChase). */
  highScoreChase: number;
  /** Score floor for unconditional MAYBE on the delta-path. */
  highScoreMaybe: number;
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = Object.freeze({
  absChase: 85,
  absMaybe: 65,
  deltaChase: 8,
  deltaMaybe: 3,
  highScoreChase: 90,
  highScoreMaybe: 85,
});

// Back-compat exports for any caller reading the old constant names.
export const ABS_CHASE_THRESHOLD = DEFAULT_THRESHOLDS.absChase;
export const ABS_MAYBE_THRESHOLD = DEFAULT_THRESHOLDS.absMaybe;
export const DELTA_CHASE = DEFAULT_THRESHOLDS.deltaChase;
export const DELTA_MAYBE = DEFAULT_THRESHOLDS.deltaMaybe;
export const HIGH_SCORE_CHASE_FLOOR = DEFAULT_THRESHOLDS.highScoreChase;
export const HIGH_SCORE_MAYBE_FLOOR = DEFAULT_THRESHOLDS.highScoreMaybe;
export const CHASE_THRESHOLD = DEFAULT_THRESHOLDS.absChase;
export const MAYBE_THRESHOLD = DEFAULT_THRESHOLDS.absMaybe;

type Tier = "CHASE" | "MAYBE" | "SKIP";

const TIER_RANK: Record<Tier, number> = { CHASE: 2, MAYBE: 1, SKIP: 0 };

/**
 * Decide the tier for a single (resource, schematic, property-group)
 * match. Pure function of (score, scoreOwned). Thresholds default to
 * DEFAULT_THRESHOLDS; the recompute orchestrator pulls user overrides
 * from settings and threads them through.
 */
export function matchTier(
  score: number,
  scoreOwned: number,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): Tier {
  if (scoreOwned <= 0) {
    if (score >= thresholds.absChase) return "CHASE";
    if (score >= thresholds.absMaybe) return "MAYBE";
    return "SKIP";
  }
  const delta = score - scoreOwned;
  if (delta >= thresholds.deltaChase) return "CHASE";
  if (score >= thresholds.highScoreChase && delta >= thresholds.deltaMaybe) return "CHASE";
  if (delta >= thresholds.deltaMaybe) return "MAYBE";
  if (score >= thresholds.highScoreMaybe) return "MAYBE";
  return "SKIP";
}

/**
 * Build a per-resource verdict from a list of per-match ScoredMatch
 * entries that already carry their `tier` (set by recompute.ts after
 * looking up scoreOwned). Returns `null` if no match qualified above
 * SKIP — in that case no row is written, the resource isn't on radar.
 *
 * Final tier = max across matches; reason = strongest match's narrative.
 * Breakdown is sorted by (tier-desc, score-desc) so consumers reading
 * `breakdown[0]` see the dominant reason.
 */
export function rollupResourceVerdict(matches: ScoredMatch[]): ResourceVerdict | null {
  if (matches.length === 0) return null;

  // Best-tier first; within tier, highest raw score first.
  const sorted = [...matches].sort((a, b) => {
    const rankDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (rankDiff !== 0) return rankDiff;
    return b.score - a.score;
  });
  const top = sorted[0];
  if (top.tier === "SKIP") return null;

  const matchedSchematicIds = new Set(matches.map((m) => m.schematicId));
  const reason = formatReason(top, matchedSchematicIds.size);

  return {
    tier: top.tier,
    reason,
    topScore: top.score,
    matchedSchematicCount: matchedSchematicIds.size,
    breakdown: sorted,
  };
}

function formatReason(top: ScoredMatch, schematicCount: number): string {
  const prop = top.propertyName ?? top.expGroup ?? "property";
  const others = schematicCount > 1 ? ` (+${schematicCount - 1} more)` : "";
  // When delta math is in play (scoreOwned > 0), surface the delta as
  // the "why" — it's the more honest framing than the raw score alone.
  if (top.scoreOwned > 0) {
    const delta = top.score - top.scoreOwned;
    const sign = delta >= 0 ? "+" : "";
    return `${top.score.toFixed(1)} on ${top.schematicName} ${prop} (${sign}${delta.toFixed(1)} vs owned)${others}`;
  }
  return `${top.score.toFixed(1)} on ${top.schematicName} ${prop}${others}`;
}
