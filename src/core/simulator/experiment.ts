// Experimentation-stage formulas — §5c of docs/crafting-math.md.
//
// Mirrors:
//   calculateExperimentationValueModifier (SharedLabratory.cpp:21)
//
// The roll itself (§5b — calculateExperimentationSuccess) is non-deterministic
// in Core3; v1 simulator assumes GREATSUCCESS per press for the "focused"
// prediction (i.e. ceiling under optimal play) and offers tier as a parameter
// for callers that want a more conservative estimate.

import { ASSEMBLY_TIER, type AssemblyTier } from "./types";

/**
 * Per-press modifier applied to a property group's `currentPercentage`,
 * scaled by `pointsAttempted`. Table per `SharedLabratory.cpp:21`:
 *
 *   AMAZINGSUCCESS    → +0.080 × points
 *   GREATSUCCESS      → +0.070 × points
 *   GOODSUCCESS       → +0.055 × points
 *   MODERATESUCCESS   → +0.015 × points
 *   SUCCESS           → +0.010 × points
 *   MARGINALSUCCESS   →  0.000
 *   OK                → -0.040 × points
 *   BARELYSUCCESSFUL  → -0.070 × points
 *   CRITICALFAILURE   → -0.080 × points
 */
export function experimentationValueModifier(
  tier: AssemblyTier,
  points: number,
): number {
  let base = 0;
  switch (tier) {
    case ASSEMBLY_TIER.AMAZINGSUCCESS:
      base = 0.08;
      break;
    case ASSEMBLY_TIER.GREATSUCCESS:
      base = 0.07;
      break;
    case ASSEMBLY_TIER.GOODSUCCESS:
      base = 0.055;
      break;
    case ASSEMBLY_TIER.MODERATESUCCESS:
      base = 0.015;
      break;
    case ASSEMBLY_TIER.SUCCESS:
      base = 0.01;
      break;
    case ASSEMBLY_TIER.MARGINALSUCCESS:
      base = 0;
      break;
    case ASSEMBLY_TIER.OK:
      base = -0.04;
      break;
    case ASSEMBLY_TIER.BARELYSUCCESSFUL:
      base = -0.07;
      break;
    case ASSEMBLY_TIER.CRITICALFAILURE:
      base = -0.08;
      break;
  }
  return base * points;
}

/**
 * Apply one experimentation press at the given tier + points. Result is
 * clamped to [0, maxPercent] (matching Core3's bounded `setCurrentPercentage`
 * behaviour).
 */
export function applyExperimentPress(
  currentPercent: number,
  maxPercent: number,
  tier: AssemblyTier,
  points: number,
): number {
  const next = currentPercent + experimentationValueModifier(tier, points);
  return Math.max(0, Math.min(maxPercent, next));
}

/**
 * "Focused experimentation" — dump ALL experimentation points on one
 * property group at the given tier (default GREATSUCCESS). Returns the
 * resulting percentage, clamped to maxPercent. Used to compute each row's
 * ceiling-if-prioritised.
 */
export function focusedExperimentation(
  startingPct: number,
  maxPct: number,
  totalPoints: number,
  tier: AssemblyTier = ASSEMBLY_TIER.GREATSUCCESS,
): number {
  return Math.max(
    0,
    Math.min(maxPct, startingPct + experimentationValueModifier(tier, totalPoints)),
  );
}
