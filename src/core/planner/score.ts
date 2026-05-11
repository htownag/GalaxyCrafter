// Per-candidate deployment value scoring.
//
// The planner's scoring target — what we sort by greedy — is:
//
//   deploymentValue = resourceScore × (concentration / 100) × BER × 24
//
// Reads as "expected score-weighted units of useful resource per day on
// that lot." `resourceScore` comes from the verdict engine (0..100, already
// profession-weighted via active schematics) or — when active list is
// empty — the SB-flag fallback path.
//
// The 24-hour multiplier is conventional and cancels across all candidates
// (it's the same constant everywhere), but we keep it explicit because the
// resulting number is the value the UI surfaces as "est daily yield" — and
// players intuit numbers in "units per day" units more cleanly than "raw
// internal score."

import type { HarvesterBucket, HarvesterSize } from "./harvesters";

export interface ScoringInput {
  resourceScore: number; // 0..100
  concentrationPct: number; // 0..100, GH-reported concentration on this planet
  ber: number; // from harvesters.json, 6..16 typical
}

const HOURS_PER_DAY = 24;

export function deploymentValue(input: ScoringInput): number {
  return (
    input.resourceScore *
    (input.concentrationPct / 100) *
    input.ber *
    HOURS_PER_DAY
  );
}

/** Cheap labelling helper for UI grouping. */
export function bucketLabel(bucket: HarvesterBucket): string {
  switch (bucket) {
    case "mineral":
      return "Mineral";
    case "chemical":
      return "Chemical";
    case "energy":
      return "Energy";
  }
}

export function sizeLabel(size: HarvesterSize): string {
  switch (size) {
    case "personal":
      return "Personal";
    case "medium":
      return "Medium";
    case "heavy":
      return "Heavy";
  }
}
