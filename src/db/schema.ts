// Drizzle schema — single source of truth. `pnpm db:generate` reads this
// and emits SQL migration files into ./drizzle/migrations/.
//
// Phase 1 scope: snapshot ingest only. Reference tables (resource_types,
// schematics) and user-state tables (characters, inventory, verdicts) come
// in Phase 2-3.

import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const snapshots = sqliteTable("snapshots", {
  id: text("id").primaryKey(),
  galaxyId: integer("galaxy_id").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
  resourceCount: integer("resource_count").notNull(),
});

// `resources` is the LIFETIME-UNION table: every resource we've ever seen
// across any snapshot, stats stored once (immutable per spawn). Currently-
// available subset = resources with a row in the latest snapshot's
// resource_observations. See research-notes.md §7.1 for the rationale —
// `all<id>.xml` returns 404 publicly so we accumulate our own history.
export const resources = sqliteTable("resources", {
  id: text("id").primaryKey(), // GH resource name; unique per galaxy
  name: text("name").notNull(),
  typeId: text("type_id").notNull(),
  typeDisplayName: text("type_display_name").notNull(),
  groupId: text("group_id").notNull(),
  enteredBy: text("entered_by"),
  addedDate: integer("added_date").notNull(),
  galaxyId: integer("galaxy_id").notNull(),
  // The 11 stats are nullable: missing tag in GH XML = stat not applicable to type.
  oq: integer("oq"),
  cr: integer("cr"),
  cd: integer("cd"),
  dr: integer("dr"),
  fl: integer("fl"),
  hr: integer("hr"),
  ma: integer("ma"),
  pe: integer("pe"),
  sr: integer("sr"),
  ut: integer("ut"),
  er: integer("er"),
  // Lifetime tracking for Phase 4 inventory autocomplete.
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

// Thin join table: which resources were present in which snapshot.
// Existence of a row = available in that snapshot. Absence = despawned by then.
export const resourceObservations = sqliteTable(
  "resource_observations",
  {
    snapshotId: text("snapshot_id").notNull(),
    resourceId: text("resource_id").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.snapshotId, t.resourceId] }),
  }),
);

// Per-resource planet list. Replaced each snapshot if planets change.
export const resourcePlanets = sqliteTable(
  "resource_planets",
  {
    resourceId: text("resource_id").notNull(),
    planet: text("planet").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.resourceId, t.planet] }),
  }),
);

// ============================================================
// Phase 2 — Reference data (loaded from bundled JSON at startup)
// ============================================================

// Per-resource-type stat caps and floors. Source: GH seedData/tResourceType.txt
// (re-parsed Core3 resource_tree.iff data, 2019 publish9 vintage).
// 0/0 cap/floor pair = stat doesn't apply to this type.
export const resourceTypes = sqliteTable("resource_types", {
  id: text("id").primaryKey(), // 'iron_axidite', 'aluminum_phrik'
  name: text("name").notNull(), // 'Axidite Iron'
  groupId: text("group_id").notNull(), // 'iron'
  parentGroup: text("parent_group"), // 'mineral', looser tier
  // 11 stat ceilings; 0 = stat doesn't apply
  capOq: integer("cap_oq").notNull().default(0),
  capCr: integer("cap_cr").notNull().default(0),
  capCd: integer("cap_cd").notNull().default(0),
  capDr: integer("cap_dr").notNull().default(0),
  capFl: integer("cap_fl").notNull().default(0),
  capHr: integer("cap_hr").notNull().default(0),
  capMa: integer("cap_ma").notNull().default(0),
  capPe: integer("cap_pe").notNull().default(0),
  capSr: integer("cap_sr").notNull().default(0),
  capUt: integer("cap_ut").notNull().default(0),
  capEr: integer("cap_er").notNull().default(0),
  // 11 stat floors
  floorOq: integer("floor_oq").notNull().default(0),
  floorCr: integer("floor_cr").notNull().default(0),
  floorCd: integer("floor_cd").notNull().default(0),
  floorDr: integer("floor_dr").notNull().default(0),
  floorFl: integer("floor_fl").notNull().default(0),
  floorHr: integer("floor_hr").notNull().default(0),
  floorMa: integer("floor_ma").notNull().default(0),
  floorPe: integer("floor_pe").notNull().default(0),
  floorSr: integer("floor_sr").notNull().default(0),
  floorUt: integer("floor_ut").notNull().default(0),
  floorEr: integer("floor_er").notNull().default(0),
});

// Schematic master. Source: GH seedData/tSchematic.txt.
export const schematics = sqliteTable("schematics", {
  id: text("id").primaryKey(), // 'weapon_rifle_t21'
  name: text("name").notNull(), // 'T21 Rifle'
  objectType: integer("object_type").notNull(), // 1=weapon, 2=armor, etc.
  skillGroup: text("skill_group"), // 'craftWeaponRangedGroupF'
  craftingTabBitmask: integer("crafting_tab_bitmask"), // 131084 — packed tab flags
  craftingTab: text("crafting_tab"), // 'crafting_weapons_general'
  complexity: integer("complexity"),
  objectSize: integer("object_size"),
  xpType: text("xp_type"),
  xpAmount: integer("xp_amount"),
  objectPath: text("object_path"), // 'object/weapon/ranged/rifle/rifle_t21.iff' — output item IFF
  parentObjectPath: text("parent_object_path"), // base class IFF, NOT a dependency graph edge
});

// Ingredient slots per schematic. Source: GH seedData/tSchematicIngredients.txt.
// ingredientType 0 = raw resource (ingredientObject = resource family slug); 1/3 = component (ingredientObject = IFF path).
export const schematicSlots = sqliteTable(
  "schematic_slots",
  {
    schematicId: text("schematic_id").notNull(),
    slotName: text("slot_name").notNull(), // 'barrel', 'frame_assembly'
    ingredientType: integer("ingredient_type").notNull(),
    ingredientObject: text("ingredient_object").notNull(), // resource family OR IFF path
    unitsRequired: integer("units_required").notNull(),
    contribution: integer("contribution"), // typically 100
  },
  (t) => ({
    pk: primaryKey({ columns: [t.schematicId, t.slotName] }),
  }),
);

// Experimental property groups per schematic. Source: GH seedData/tSchematicQualities.txt.
// Rows with propertyName=null are derived attributes the player can't experiment on directly.
export const schematicPropertyGroups = sqliteTable("schematic_property_groups", {
  id: integer("id").primaryKey(), // 101120 — preserved from GH auto-id; joins to weights
  schematicId: text("schematic_id").notNull(),
  propertyName: text("property_name"), // 'mindamage', 'hitpoints'; null for non-experimental
  expGroup: text("exp_group"), // 'expDamage', 'expEffeciency', 'exp_durability', 'expRange'
  weightTotal: integer("weight_total").notNull().default(0),
});

// Per-stat weight for each property group. Source: GH seedData/tSchematicResWeights.txt.
// weight is integer 1..5; normalised at query time when computing scores.
export const schematicPropertyWeights = sqliteTable(
  "schematic_property_weights",
  {
    groupId: integer("group_id").notNull(),
    stat: text("stat").notNull(), // 'OQ', 'CD', 'SR', etc.
    weight: integer("weight").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.stat] }),
  }),
);

// Derived during import: which schematics feed (as sub-components) into which parents.
// N:M — a sub-component IFF can be consumed by many parent schematics.
export const schematicDependencies = sqliteTable(
  "schematic_dependencies",
  {
    parentSchematicId: text("parent_schematic_id").notNull(),
    childSchematicId: text("child_schematic_id").notNull(),
    slotName: text("slot_name").notNull(), // which slot in the parent
  },
  (t) => ({
    pk: primaryKey({ columns: [t.parentSchematicId, t.childSchematicId, t.slotName] }),
  }),
);

// Records when a reference-data JSON file was last loaded. Hash-compared at
// startup to skip reload when content hasn't changed.
export const referenceMeta = sqliteTable("reference_meta", {
  source: text("source").primaryKey(), // 'resource-types' | 'schematics'
  contentHash: text("content_hash").notNull(),
  loadedAt: integer("loaded_at").notNull(),
  rowCount: integer("row_count"),
});

// ============================================================
// Phase 2 — User state
// ============================================================

// One row per player character. Active character is chosen via settings.
export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(), // uuid
  name: text("name").notNull(),
  galaxyId: integer("galaxy_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Profession ranking per character.
export const professionPriorities = sqliteTable(
  "profession_priorities",
  {
    characterId: text("character_id").notNull(),
    profession: text("profession").notNull(), // 'weaponsmith', 'artisan', etc.
    tier: text("tier").notNull(), // 'primary' | 'secondary' | 'ignored'
    rank: integer("rank").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.characterId, t.profession] }),
  }),
);

// Per-character active schematic list — the canonical input to the verdict
// engine (Phase 3). source='user' = explicitly added; source='inherited' =
// auto-added as a sub-component of a primary-profession parent (§5.4.1).
export const activeSchematics = sqliteTable(
  "active_schematics",
  {
    characterId: text("character_id").notNull(),
    schematicId: text("schematic_id").notNull(),
    source: text("source").notNull(), // 'user' | 'inherited'
    parentSchematicId: text("parent_schematic_id"), // set when source='inherited'
    addedAt: integer("added_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.characterId, t.schematicId] }),
  }),
);

// Single-row key/value store for app-wide settings. JSON-encoded values.
// Known keys: 'active.character', 'ui.layout', 'verdict.thresholds',
// 'ingest.intervalHours'.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});
