// Greedy lot-fill allocator with bucket-diversity cap.
//
// Pure function; no DB / IPC. Pass in the pre-built candidate list, get
// back the picked subset + summary. The candidate list is constructed
// upstream by the IPC handler from the snapshot's resources × verdict
// scores × bucket classification.

import type { HarvesterBucket, HarvesterSize } from "./harvesters";

export interface Candidate {
  resourceId: string;
  resourceName: string;
  planet: string;
  concentrationPct: number;
  resourceScore: number; // 0..100 in normal mode; raw PE 0..1000 in power mode
  bucket: HarvesterBucket;
  size: HarvesterSize;
  ber: number;
  /** Harvester catalogue id picked for this candidate. Carries through to the
   * UI label — important for fusion-generator picks where the harvester
   * differs from the bucket's generic heavy. */
  harvesterId: string;
  harvesterLabel: string;
  deploymentValue: number; // pre-computed via score.ts
  estDailyYield: number; // power units/day in power mode; raw units/day otherwise
}

export interface AllocateInput {
  candidates: Candidate[];
  lotsAvailable: number; // 0..10 per SWG rules
  diversity: boolean;
}

export interface AllocateResult {
  selected: Array<Candidate & { rank: number }>;
  summary: {
    lotsUsed: number;
    totalDeploymentValue: number;
    bucketBreakdown: Record<HarvesterBucket, number>;
  };
}

/**
 * Greedy fill. Sorts candidates desc by deploymentValue, walks them in
 * order, takes each one that:
 *   - doesn't duplicate a resourceId we've already picked
 *   - doesn't push its bucket past the diversity cap (when diversity=true)
 *
 * Stops when lotsAvailable is exhausted.
 */
export function allocate(input: AllocateInput): AllocateResult {
  const lots = Math.max(0, Math.min(10, Math.floor(input.lotsAvailable)));
  if (lots === 0) {
    return emptyResult();
  }

  // §4 of the plan doc: bucket diversity cap = ceil(lotsAvailable × 0.6).
  // Set to lots itself when diversity=false (effectively disabling the cap).
  const bucketCap = input.diversity ? Math.ceil(lots * 0.6) : lots;

  const sorted = [...input.candidates].sort(
    (a, b) => b.deploymentValue - a.deploymentValue,
  );

  const selected: Array<Candidate & { rank: number }> = [];
  const seenResources = new Set<string>();
  const bucketCount: Record<HarvesterBucket, number> = {
    mineral: 0,
    chemical: 0,
    energy: 0,
  };
  let totalDeploymentValue = 0;

  for (const c of sorted) {
    if (selected.length >= lots) break;
    if (seenResources.has(c.resourceId)) continue;
    if (bucketCount[c.bucket] >= bucketCap) continue;

    selected.push({ ...c, rank: selected.length + 1 });
    seenResources.add(c.resourceId);
    bucketCount[c.bucket] += 1;
    totalDeploymentValue += c.deploymentValue;
  }

  return {
    selected,
    summary: {
      lotsUsed: selected.length,
      totalDeploymentValue,
      bucketBreakdown: bucketCount,
    },
  };
}

function emptyResult(): AllocateResult {
  return {
    selected: [],
    summary: {
      lotsUsed: 0,
      totalDeploymentValue: 0,
      bucketBreakdown: { mineral: 0, chemical: 0, energy: 0 },
    },
  };
}
