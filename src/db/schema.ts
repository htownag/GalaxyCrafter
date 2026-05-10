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
