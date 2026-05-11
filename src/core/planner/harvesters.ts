// Harvester catalogue. Loaded from reference-data/harvesters.json at
// import time — the file is small (12 rows) and never changes per
// snapshot, so module-scope is the simplest cache.

import harvesterDataRaw from "../../../reference-data/harvesters.json";

export type HarvesterSize = "personal" | "medium" | "heavy";
export type HarvesterBucket = "mineral" | "chemical" | "energy";

export interface HarvesterDef {
  id: string;
  label: string;
  size: HarvesterSize;
  bucket: HarvesterBucket;
  ber: number;
  hopper: number;
  lots: number;
  installationType: number;
  /** Optional human-readable note (e.g. "no size variants for energy"). */
  note?: string;
}

interface HarvesterFile {
  provenance: { source: string; note: string; lastVerified: string };
  harvesters: HarvesterDef[];
}

const data = harvesterDataRaw as HarvesterFile;

export const HARVESTERS: readonly HarvesterDef[] = data.harvesters;

/** Best harvester (highest BER) for a given (size, bucket) pair. */
export function harvesterFor(
  size: HarvesterSize,
  bucket: HarvesterBucket,
): HarvesterDef | null {
  // For energy bucket we have two installations (wind + solar) at the same
  // BER; either works for v1 — pick the first match.
  return HARVESTERS.find((h) => h.size === size && h.bucket === bucket) ?? null;
}

export const HARVESTER_SIZES: readonly HarvesterSize[] = ["personal", "medium", "heavy"];
export const HARVESTER_BUCKETS: readonly HarvesterBucket[] = ["mineral", "chemical", "energy"];
