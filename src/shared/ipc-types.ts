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
  /**
   * Count of inventory rows auto-flipped from `live` → `despawned` because
   * the resource they reference is no longer in the latest snapshot.
   * Cross-character. Phase 4E.
   */
  inventoryAutoFlipped: number;
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
  ingredientObject: string; // resource family slug OR IFF path (canonical id)
  /**
   * In-game UI display name for `ingredientObject`. For raw resources
   * (type 0), this is the resource group / type display name from the
   * reference data (e.g. `copper_diatium` → "Diatium Copper"). For
   * component slots (type 1/3), it's the component schematic's name when
   * the IFF resolves, or a humanised basename fallback otherwise. Falls
   * back to `ingredientObject` itself if no lookup matches.
   */
  ingredientDisplayName: string;
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

export type InventoryStatus = "live" | "despawned" | "reserved";

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

// === Phase 4E: GH single-resource lookup ===

export interface GhLookupInput {
  name: string;
  galaxyId: number;
}

export interface GhLookupResponse {
  found: boolean;
  /** Populated when found=true. Already persisted to local `resources` table. */
  resource: Resource | null;
  /** When set, the resource was unavailable (despawned) on GH as of this ms timestamp. */
  unavailableAt: number | null;
  unavailableBy: string | null;
  /** True when GH found it but we already had the same id locally (no write performed). */
  alreadyLocal: boolean;
}

// === Phase 5: Resource Finder ===

export interface FinderRankInput {
  schematicId: string;
  /** If omitted, the handler defaults to the first scoreable property group on the schematic. */
  propertyGroupId?: number;
  /** Default true. When false, score every resource regardless of slot-fit (escape hatch). */
  slotFilter?: boolean;
}

export interface FinderPropertyGroupOption {
  id: number;
  propertyName: string | null;
  expGroup: string | null;
  weights: Array<{ stat: string; weight: number }>;
}

export interface FinderResultRow {
  resourceId: string;
  resourceName: string;
  typeId: string;
  typeDisplayName: string;
  groupId: string;
  planets: string[];
  /** Score against the chosen property group. */
  score: number;
  /** Owned-best score across the user's inventory for this same (schematic, propertyGroup). */
  scoreOwned: number;
  /** Resource's stats for the property group's weighted stats — for "why this rank" reveal. */
  weightedStats: Array<{ stat: string; value: number | null }>;
  /** True when this resource is in the active character's inventory. */
  owned: boolean;
  ownedUnits: number | null;
  /** Slots on the schematic this resource fits. Empty if slotFilter=false bypassed compat. */
  fitsSlots: string[];
}

export interface FinderResult {
  schematic: {
    id: string;
    name: string;
    profession: string | null;
  };
  /** All scoreable property groups on the schematic, for the picker. */
  availableGroups: FinderPropertyGroupOption[];
  /** The currently-selected property group (echo of input or defaulted). */
  selectedGroup: FinderPropertyGroupOption;
  slotFilter: boolean;
  /** Ranked results, highest score first. */
  rows: FinderResultRow[];
}

// === Phase 9c: Settings ===

export interface VerdictThresholdsView {
  absChase: number;
  absMaybe: number;
  deltaChase: number;
  deltaMaybe: number;
  highScoreChase: number;
  highScoreMaybe: number;
}

export interface SettingsSnapshot {
  thresholds: VerdictThresholdsView;
  /** True iff any threshold is non-default. */
  thresholdsCustomised: boolean;
}

export interface SettingsExportResult {
  /** Where the file was written. Null if user cancelled. */
  path: string | null;
  /** Bytes written. Null if cancelled. */
  bytes: number | null;
  /** Counts of rows by table, for the toast/UI. */
  rowCounts: Record<string, number>;
}

// === Phase 9b: Schematic dependency tree ===

/**
 * One node in a recursive schematic dependency tree. A node represents either
 * the root schematic or a sub-component schematic that fills a slot on its
 * parent.
 */
export interface SchematicDepNode {
  schematicId: string;
  schematicName: string;
  profession: string | null;
  /** Slot on the parent that this node fills. Null for the root. */
  parentSlotName: string | null;
  /** ingredientType from the parent's slot — 0 = raw resource (this node will
   *  be null for raw slots; sub-components are non-zero), 1 = specific,
   *  3 = base-class, etc. */
  parentIngredientType: number | null;
  /** Distance from root. Root = 0. */
  depth: number;
  /** Children of THIS node (recursive). Empty when the node is a leaf, when
   *  depth >= maxDepth, or when a cycle was detected (we never recurse into
   *  an ancestor). */
  children: SchematicDepNode[];
  /** True iff this node was capped at maxDepth and has further children we
   *  didn't load. Lets the UI offer a "load deeper" affordance. */
  truncated: boolean;
}

/**
 * Raw slot info attached at the level of any node so the UI can show
 * "this schematic also wants 12 units of `metal_ferrous`" alongside the
 * sub-component branches.
 */
export interface SchematicDepRawSlot {
  slotName: string;
  ingredientObject: string;
  unitsRequired: number;
  /** Human-friendly label if the slot's ingredient resolves to a known
   *  resource group / type / IFF. Same resolution as SchematicDetail uses. */
  displayName: string | null;
}

export interface SchematicDepTreeResult {
  /** Echoes the requested root for round-trip safety. */
  rootId: string;
  /** Max recursion depth used for this fetch (default 4). */
  maxDepth: number;
  /** Full tree. */
  root: SchematicDepNode;
  /** Per-node raw-resource slots, keyed by schematicId. The same schematic
   *  appearing multiple times in the tree shares its raw-slot list. */
  rawSlotsBySchematic: Record<string, SchematicDepRawSlot[]>;
}

// === Phase 9: Dashboard ===
//
// One landing screen pulling Verdict + SB + Inventory into a single home view.
// Per the design's §5.1 "killer organizing screen" framing — replaces the
// Resources tab as the app's default landing page.

/** A resource card on Right Now / On Watch lanes — verdict-driven. */
export interface DashboardVerdictCard {
  resourceId: string;
  resourceName: string;
  typeDisplayName: string;
  planets: string[];
  /** Top 2 stats by raw value, name + value. */
  topStats: Array<{ stat: StatKey; value: number }>;
  tier: VerdictTier;
  topScore: number;
  reason: string;
  /** Number of schematics this resource scored CHASE/MAYBE/SKIP for. */
  matchedSchematicCount: number;
  /** True if the resource appears in this character's inventory (any status). */
  owned: boolean;
}

/** SB Collection lane entry. */
export interface DashboardSbCard {
  resourceId: string;
  resourceName: string;
  typeDisplayName: string;
  planets: string[];
  topStats: Array<{ stat: StatKey; value: number }>;
  forProfession: string;
  /** Whether this is the character's primary, secondary, or other profession. */
  professionTier: "primary" | "secondary" | "other";
  sbTier: SbTier;
  score: number;
  topScoreOnSnapshot: number;
  schematicId: string | null;
  owned: boolean;
}

/** One active schematic's slot-readiness for the inventory-health lane. */
export interface DashboardSchematicReadiness {
  schematicId: string;
  schematicName: string;
  profession: string | null;
  /** True iff every raw slot has at least one fitting inventory resource (live status). */
  craftableNow: boolean;
  totalSlots: number;
  filledSlots: number;
  /** Slot names with no matching live inventory resource. */
  missingSlots: Array<{ slotName: string; ingredientObject: string; unitsRequired: number }>;
}

export interface DashboardInventoryHealth {
  activeSchematicCount: number;
  craftableNow: number;
  /** Live-inventory resource count for the character. */
  liveInventoryCount: number;
  /** Top N schematics by readiness (most-craftable first), with missing-slot detail. */
  topSchematics: DashboardSchematicReadiness[];
}

export interface DashboardData {
  characterName: string;
  galaxyId: number;
  /** Top 5 CHASE-tier resources, score-desc. */
  rightNow: DashboardVerdictCard[];
  /** Top 10 MAYBE-tier resources, score-desc. */
  onWatch: DashboardVerdictCard[];
  /** SB flags for character's primary + secondary profs, weighted, top 10. */
  sbCollection: DashboardSbCard[];
  inventoryHealth: DashboardInventoryHealth;
  /** Time the source snapshot was fetched, for "as of N min ago" display. */
  snapshotFetchedAt: number | null;
}

// === Phase 6: Crafting simulator ===

export interface SimulatorSkillProfile {
  assemblySkill: number;
  experimentationSkill: number;
  toolEffectiveness: number;
}

/** Per-slot resource choice. Slots not in `slotChoices` default to perfect. */
export type SimulatorSlotChoice =
  | { type: "hypothetical_perfect" }
  | { type: "resource"; resourceId: string }
  /**
   * Manual stat-vector entry. Used for sub-component slots (ingredientType ≠ 0):
   * crafted sub-components, looted exotics. User types in the values they
   * observe on the item in-game. Stats not in the map are treated as 0.
   * Only stats with weight > 0 in at least one of the parent's property
   * groups are surfaced in the UI; the rest are zero-by-default and don't
   * affect the math.
   */
  | { type: "manual"; stats: Partial<ResourceStats> };

export interface SimulatorPredictInput {
  schematicId: string;
  /** v1.1: per-slot choice. Slots without an entry default to hypothetical-perfect. */
  slotChoices?: Record<string, SimulatorSlotChoice>;
  skillProfile?: SimulatorSkillProfile;
  /** Defaults to 1 (GREATSUCCESS) — the realistic competent-crafter baseline. */
  assemblyTier?: number;
}

/** A resource available to fill a given slot — owned inventory or currently spawning. */
export interface SimulatorSlotOption {
  resourceId: string;
  resourceName: string;
  /** "owned" = lives in player inventory; "spawn" = currently spawning on the latest snapshot. */
  source: "owned" | "spawn";
  /** Units the player has on hand (only for owned). */
  ownedUnits?: number;
  /** Top-line OQ stat for quick scan in the dropdown. Null if the resource type doesn't carry OQ. */
  oq: number | null;
  /** Type-display-name, e.g. "Iron Dolovite" — shown after the resource name in the dropdown. */
  typeDisplayName: string;
}

export interface SimulatorSlotInfo {
  slotName: string;
  /** Resource family or IFF path the schematic slot accepts. */
  ingredientObject: string;
  unitsRequired: number;
  /** Resources in the player's inventory that fit this slot, sorted by name. */
  ownedOptions: SimulatorSlotOption[];
  /** Currently-spawning resources that fit this slot, sorted by name. */
  spawnOptions: SimulatorSlotOption[];
  /** Whatever the prediction used for this slot. */
  chosen:
    | { type: "hypothetical_perfect" }
    | { type: "resource"; resourceId: string; resourceName: string }
    | { type: "manual"; stats: Partial<ResourceStats> };
  /** True when this slot is a sub-component slot (ingredientType ≠ 0). */
  isSubComponent: boolean;
}

export interface SimulatorPredictedGroup {
  id: number;
  propertyName: string | null;
  expGroup: string | null;
  weights: Array<{ stat: string; weight: number }>;
  weightedSum: number; // 0..1000
  maxPercent: number; // 0..100
  startingPercent: number; // 0..100
  /** Final % if ALL experimentation points dumped on this row at GREATSUCCESS. */
  focusedPercent: number;
  // Real-world value projection. Null when the schematic-experimental-ranges
  // join didn't find a range (mostly non-craftable items + some legacy schems).
  /** Authored min/max from SR2's template Lua. May be reversed (min > max)
   *  for properties where lower is better — see `inverted`. */
  expMin: number | null;
  expMax: number | null;
  /** Decimal places to display (attackspeed = 1, mindamage = 0). */
  expPrecision: number | null;
  /** True when min > max → lower is better. */
  inverted: boolean | null;
  /** Interpolated value at startingPercent / focusedPercent, in real units. */
  startingValue: number | null;
  focusedValue: number | null;
}

export interface SimulatorPredictResult {
  schematic: {
    id: string;
    name: string;
    profession: string | null;
    complexity: number | null;
  };
  /** Per-slot fit options + the chosen resource per slot. */
  slots: SimulatorSlotInfo[];
  /** "perfect" iff every slot is hypothetical-perfect; "mixed" otherwise. */
  slotConfigSummary: "perfect" | "mixed";
  /** Stats with weight > 0 in at least one of the parent's property groups.
   * Used by the UI to filter the manual-entry inputs down to the ones that
   * actually affect predictions. */
  relevantStats: StatKey[];
  assumptions: {
    skillProfile: SimulatorSkillProfile;
    assemblyTier: number;
    experimentationPointBudget: number;
  };
  propertyGroups: SimulatorPredictedGroup[];
}

// === Phase 7: New-player harvester planner ===

export type HarvesterSize = "personal" | "medium" | "heavy";
export type HarvesterBucket = "mineral" | "chemical" | "energy";

export interface PlannerInput {
  characterId: string;
  /** 0..10, default 10. Hard cap is 10 (SWG lot rule). */
  lotsAvailable: number;
  /** Planet name (e.g. "tatooine") or omitted for "any planet". */
  planetBias?: string;
  /** Apply bucket-diversity cap (max 60% per bucket). Default on. */
  diversity: boolean;
  /** Mix SB-flag scores into personal verdicts. Forced on when active list is empty. */
  includeSbLane: boolean;
  /**
   * Score by PE (Potential Energy) stat instead of profession verdict. Surfaces
   * high-PE fuel resources — radioactive minerals, petrochem-fuel chemicals,
   * solar/wind energy spawns — for fueling power generators. Bypasses verdict
   * and SB-lane scoring entirely; concentration floor still applies.
   */
  buildPowerReserves: boolean;
}

export interface PlannerRecommendation {
  rank: number;
  resourceId: string;
  resourceName: string;
  bucket: HarvesterBucket;
  size: HarvesterSize;
  harvesterLabel: string;
  planet: string;
  resourceScore: number;
  deploymentValue: number;
  /** Ceiling daily yield (BER × 24, or PE-multiplier × BER × 24 in power mode).
   * v1 has no concentration data so this is the 100%-conc ceiling, not a
   * site-specific projection. */
  estDailyYield: number;
}

export interface PlannerResult {
  recommendations: PlannerRecommendation[];
  summary: {
    lotsUsed: number;
    totalDeploymentValue: number;
    bucketBreakdown: Record<HarvesterBucket, number>;
  };
  /** Populated when scoring leaned on SB lane because active list was empty,
   * OR when buildPowerReserves is on (PE-driven scoring). */
  fallbackMode?: "no-active-schematics" | "power-reserves";
  /** Always echoed back for UI ribbon text. */
  characterProfessions: {
    primary: string[];
    secondary: string[];
  };
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

// === Phase 8a: Server-Best flags ===

export type SbTier = "SB_TOP" | "SB_NEAR";

export interface SbFlagEntry {
  resourceId: string;
  forProfession: string; // profession id, e.g. 'weaponsmith'
  tier: SbTier;
  /** The resource's score on its best (schematic, propertyGroup) for this profession. */
  score: number;
  /** Server-best score this profession reached at all on that snapshot. */
  topScoreOnSnapshot: number;
  /** Schematic id that produced the score. */
  schematicId: string | null;
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

  // The active character's inventory entry for this resource, if any.
  // Phase 4D surfaces this on the detail page as a dedicated section so
  // owned resources clearly show "you have X units, status, notes."
  inventory: InventoryEntry | null;

  // Server-best flags for this resource on the latest snapshot, across
  // all 8 crafting professions. Empty array when no flags. Phase 8a.
  sbFlags: SbFlagEntry[];
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
  setProfessionPriorities(
    characterId: string,
    priorities: ProfessionPriority[],
  ): Promise<ProfessionPriority[]>;

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

  // Phase 8a — server-best flags (orthogonal to verdicts; galaxy-wide)
  listSbFlags(galaxyId: number): Promise<SbFlagEntry[]>;

  // Phase 4 — inventory
  listInventory(characterId: string): Promise<InventoryEntry[]>;
  upsertInventory(input: InventoryUpsertInput): Promise<InventoryEntry>;
  removeInventory(characterId: string, resourceId: string): Promise<void>;

  // Phase 5 — Resource Finder (schematic-driven reverse search)
  rankResourcesForSchematic(input: FinderRankInput): Promise<FinderResult | null>;

  // Phase 7 — New-player harvester planner
  recommendHarvesters(input: PlannerInput): Promise<PlannerResult>;

  // Phase 6 — Crafting simulator
  predictManufacture(input: SimulatorPredictInput): Promise<SimulatorPredictResult | null>;

  // Phase 9 — Dashboard
  fetchDashboard(characterId: string): Promise<DashboardData | null>;

  // Phase 9b — Schematic dependency tree
  getSchematicDepTree(schematicId: string, maxDepth?: number): Promise<SchematicDepTreeResult | null>;

  // Phase 9c — Settings
  getSettings(): Promise<SettingsSnapshot>;
  saveVerdictThresholds(t: VerdictThresholdsView): Promise<SettingsSnapshot>;
  resetVerdictThresholds(): Promise<SettingsSnapshot>;
  exportUserData(): Promise<SettingsExportResult>;

  // Phase 4E — GH single-resource lookup
  lookupGhResource(input: GhLookupInput): Promise<GhLookupResponse>;
  /**
   * Subscribe to verdict recompute completion. Listener fires whenever any
   * mutation (snapshot refresh, active schematic add/remove, character
   * create) triggered an implicit recompute. Returns an unsubscribe
   * function — call it from useEffect cleanup.
   */
  onVerdictsUpdated(listener: (payload: { characterId: string }) => void): () => void;
}
