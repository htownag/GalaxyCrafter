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

// === Phase 3: verdicts ===

export type VerdictTier = "CHASE" | "MAYBE" | "SKIP";

export interface VerdictEntry {
  resourceId: string;
  tier: VerdictTier;
  reason: string;
  topScore: number;
  matchedSchematicCount: number;
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
  /**
   * Subscribe to verdict recompute completion. Listener fires whenever any
   * mutation (snapshot refresh, active schematic add/remove, character
   * create) triggered an implicit recompute. Returns an unsubscribe
   * function — call it from useEffect cleanup.
   */
  onVerdictsUpdated(listener: (payload: { characterId: string }) => void): () => void;
}
