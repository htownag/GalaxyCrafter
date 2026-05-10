// IPC contract + canonical domain types.
// Imported by main, preload, and renderer.

export interface ResourceStats {
  OQ: number | null;
  CR: number | null;
  CD: number | null;
  DR: number | null;
  FL: number | null;
  HR: number | null;
  MA: number | null;
  PE: number | null;
  SR: number | null;
  UT: number | null;
  ER: number | null;
}

export const STAT_KEYS = ["OQ", "CR", "CD", "DR", "FL", "HR", "MA", "PE", "SR", "UT", "ER"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export interface Resource {
  id: string;
  name: string;
  typeId: string;
  typeDisplayName: string;
  groupId: string;
  enteredBy: string;
  addedDate: number; // unix ms
  galaxyId: number;
  stats: ResourceStats;
  planets: string[];
}

export interface SnapshotSummary {
  id: string;
  galaxyId: number;
  fetchedAt: number;
  resourceCount: number;
}

export interface RefreshResult {
  snapshot: SnapshotSummary;
  newResourceCount: number;
  despawnedResourceCount: number;
  durationMs: number;
}

// Renderer-visible API surface, exposed via preload contextBridge as window.api.
export interface IpcApi {
  refreshSnapshot(galaxyKey?: string): Promise<RefreshResult>;
  getLatestSnapshot(): Promise<SnapshotSummary | null>;
  listResources(snapshotId?: string): Promise<Resource[]>;
}
