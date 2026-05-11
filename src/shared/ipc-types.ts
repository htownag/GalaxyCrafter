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

export const STAT_KEYS = [
  "OQ",
  "CR",
  "CD",
  "DR",
  "FL",
  "HR",
  "MA",
  "PE",
  "SR",
  "UT",
  "ER",
] as const;
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

// === Phase 2: character / schematic / reference domain types ===

export interface Character {
  id: string;
  name: string;
  galaxyId: number;
  createdAt: number;
}

export type ProfessionTier = "primary" | "secondary" | "ignored";

export interface ProfessionPriority {
  profession: string;
  tier: ProfessionTier;
  rank: number;
}

export interface ResourceTypeRef {
  id: string;
  name: string;
  groupId: string;
  parentGroup: string;
  caps: Record<string, number>;
  floors: Record<string, number>;
}

export interface SchematicSummary {
  id: string;
  name: string;
  objectType: number;
  skillGroup: string | null;
  craftingTab: string | null;
  complexity: number;
  profession: string | null; // derived from skillGroup
  isActive: boolean; // active on the current character
}

export interface SchematicSlot {
  slotName: string;
  ingredientType: number; // 0=raw, 1=specific component, 3=base-class component
  ingredientObject: string; // resource family slug OR IFF path
  unitsRequired: number;
  contribution: number;
}

export interface SchematicPropertyGroupDetail {
  id: number;
  propertyName: string | null;
  expGroup: string | null;
  weightTotal: number;
  weights: Array<{ stat: string; weight: number }>;
}

export interface SchematicDependencyDetail {
  slotName: string;
  childSchematicId: string;
  childName: string;
}

export interface SchematicDetail {
  id: string;
  name: string;
  objectType: number;
  skillGroup: string | null;
  craftingTab: string | null;
  craftingTabBitmask: number;
  complexity: number;
  objectSize: number;
  xpType: string | null;
  xpAmount: number;
  objectPath: string;
  parentObjectPath: string;
  profession: string | null;
  slots: SchematicSlot[];
  propertyGroups: SchematicPropertyGroupDetail[];
  dependencies: SchematicDependencyDetail[];
  isActive: boolean;
}

export interface ActiveSchematicEntry {
  schematicId: string;
  schematicName: string;
  source: "user" | "inherited";
  parentSchematicId: string | null;
  parentSchematicName: string | null;
  addedAt: number;
  profession: string | null;
  craftingTab: string | null;
}

export interface CreateCharacterInput {
  name: string;
  galaxyId: number;
  priorities: ProfessionPriority[];
}

// === Phase 4: inventory ===

export type InventoryStatus = "live" | "banked" | "reserved";

export interface InventoryEntry {
  characterId: string;
  resourceId: string;
  resourceName: string;
  typeDisplayName: string;
  units: number;
  status: InventoryStatus;
  notes: string | null;
  addedAt: number;
  updatedAt: number;
}

export interface InventoryUpsertInput {
  characterId: string;
  resourceId: string;
  units: number;
  status: InventoryStatus;
  notes?: string | null;
}

// === Phase 3: verdicts ===

export type VerdictTier = "CHASE" | "MAYBE" | "SKIP";

export interface VerdictEntry {
  resourceId: string;
  tier: VerdictTier;
  reason: string;
  topScore: number;
  matchedSchematicCount: number;
}

/**
 * Single (schematic, property-group) match for a resource. Matches the
 * shape persisted in `verdicts.breakdown_json`.
 *
 * Phase 4 fields: `scoreOwned` is the character's best-owned score on the
 * same (schematic, propertyGroup); `tier` is the per-match verdict from
 * the §5.2.5 dichotomy. Pre-Phase-4 persisted rows lack these fields —
 * renderers should treat them as `scoreOwned: 0`, `tier: 'SKIP'` when
 * undefined (data migrates lazily on next recompute).
 */
export interface ScoredMatchView {
  schematicId: string;
  schematicName: string;
  propertyGroupId: number;
  propertyName: string | null;
  expGroup: string | null;
  score: number;
  scoreOwned?: number;
  tier?: VerdictTier;
  inheritedFromParent: boolean;
}

/**
 * Per-resource detail payload. Shipping Phase 3B: stats + bounds, verdict
 * + breakdown, and "fits these active schematics" rollup. Image, despawn
 * estimate, owned-best/delta, and waypoint concentration are deferred —
 * they need data we don't ingest yet (image) or Phase 4 inventory (deltas).
 */
export interface ResourceDetail {
  // Identity
  id: string;
  name: string;
  typeId: string;
  typeDisplayName: string;
  groupId: string;
  groupName: string | null; // "Iron" for groupId=iron, via resource_groups table
  enteredBy: string;
  addedDate: number;
  galaxyId: number;
  planets: string[];

  // 11 stats with their per-type bounds for percent-of-cap visualisation.
  stats: ResourceStats;
  caps: Record<string, number>;
  floors: Record<string, number>;

  // Verdict (only present when an active character has a verdict for this
  // resource in the current snapshot). breakdown is the full per-match
  // detail deserialised from the persisted JSON, sorted descending by score.
  verdict: {
    tier: VerdictTier;
    reason: string;
    topScore: number;
    matchedSchematicCount: number;
    breakdown: ScoredMatchView[];
  } | null;

  // Active schematics that have at least one raw-resource slot this resource
  // type fits. Useful for "this resource type fills the Stock slot on T21
  // Heavy Carbine and the Power Handler on DH17" — orientation independent
  // of whether the verdict broke threshold.
  fitsActiveSchematics: Array<{
    schematicId: string;
    schematicName: string;
    profession: string | null;
    inheritedFromParent: boolean;
    matchingSlots: string[];
  }>;
}

export interface SchematicListFilter {
  query?: string;
  profession?: string;
  objectType?: number;
  onlyActive?: boolean;
}

// Renderer-visible API surface, exposed via preload contextBridge as window.api.
export interface IpcApi {
  // Phase 1
  refreshSnapshot(galaxyKey?: string): Promise<RefreshResult>;
  getLatestSnapshot(): Promise<SnapshotSummary | null>;
  listResources(snapshotId?: string): Promise<Resource[]>;

  // Phase 2 — characters
  listCharacters(): Promise<Character[]>;
  getActiveCharacter(): Promise<Character | null>;
  createCharacter(input: CreateCharacterInput): Promise<Character>;
  setActiveCharacter(id: string): Promise<void>;
  getProfessionPriorities(characterId: string): Promise<ProfessionPriority[]>;

  // Phase 2 — schematics
  listSchematics(filter?: SchematicListFilter): Promise<SchematicSummary[]>;
  getSchematicDetail(id: string): Promise<SchematicDetail | null>;
  listActiveSchematics(characterId: string): Promise<ActiveSchematicEntry[]>;
  addActiveSchematic(
    characterId: string,
    schematicId: string,
    withSubcomponents: boolean,
  ): Promise<{ added: string[]; skipped: string[] }>;
  removeActiveSchematic(characterId: string, schematicId: string): Promise<void>;

  // Phase 2 — resource types
  getResourceType(id: string): Promise<ResourceTypeRef | null>;

  // Phase 3 — verdicts
  listVerdicts(characterId: string): Promise<VerdictEntry[]>;
  getResourceDetail(resourceId: string): Promise<ResourceDetail | null>;

  // Phase 4 — inventory
  listInventory(characterId: string): Promise<InventoryEntry[]>;
  upsertInventory(input: InventoryUpsertInput): Promise<InventoryEntry>;
  removeInventory(characterId: string, resourceId: string): Promise<void>;
  /**
   * Subscribe to verdict recompute completion. Listener fires whenever any
   * mutation (snapshot refresh, active schematic add/remove, character
   * create) triggered an implicit recompute. Returns an unsubscribe
   * function — call it from useEffect cleanup.
   */
  onVerdictsUpdated(listener: (payload: { characterId: string }) => void): () => void;
}
