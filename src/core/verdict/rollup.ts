// Per-resource verdict rollup.
//
// Phase 3 uses absolute thresholds (advisor decision, transitional until
// Phase 4 layers in delta-vs-owned):
//
//     score >= 90 → CHASE
//     score >= 70 → MAYBE
//     otherwise   → SKIP   (no row written; resource isn't on the user's radar)
//
// Profession-tier gating and the secondary-downgrade rule (design report
// §5.2.6) are deferred — they require owned-best data that lands in Phase 4.

import type { ResourceVerdict, ScoredMatch } from "./types";

export const CHASE_THRESHOLD = 90;
export const MAYBE_THRESHOLD = 70;

/**
 * Build a per-resource verdict from a flat list of (schematic, property
 * group) match scores. Returns `null` if no schematic matched at all OR if
 * the top score is below the MAYBE threshold — in both cases the resource
 * isn't relevant and we don't write a verdict row.
 *
 * The breakdown is sorted highest-score-first so the drill-down UI can
 * `breakdown[0]` to surface the dominant reason.
 */
export function rollupResourceVerdict(matches: ScoredMatch[]): ResourceVerdict | null {
  if (matches.length === 0) return null;

  // Sort highest score first so breakdown[0] is the strongest reason.
  const sorted = [...matches].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const topScore = top.score;

  if (topScore < MAYBE_THRESHOLD) return null;

  const matchedSchematicIds = new Set(matches.map((m) => m.schematicId));
  const reason = formatReason(top, matchedSchematicIds.size);

  let tier: ResourceVerdict["tier"];
  if (topScore >= CHASE_THRESHOLD) tier = "CHASE";
  else tier = "MAYBE";

  return {
    tier,
    reason,
    topScore,
    matchedSchematicCount: matchedSchematicIds.size,
    breakdown: sorted,
  };
}

function formatReason(top: ScoredMatch, schematicCount: number): string {
  // The reason is one short sentence shown next to the pill. Drill-down UI
  // will render the full breakdown later (Phase 5).
  const prop = top.propertyName ?? top.expGroup ?? "property";
  const others = schematicCount > 1 ? ` (+${schematicCount - 1} more)` : "";
  return `${top.score.toFixed(1)} on ${top.schematicName} ${prop}${others}`;
}
