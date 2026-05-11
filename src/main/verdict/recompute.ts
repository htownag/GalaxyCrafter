// Orchestrator — the main-side glue between the pure scoring core
// (`src/core/verdict/`) and the Drizzle database. Lives outside `src/core/`
// so that boundary stays renderer-importable.
//
// Called from IPC mutation handlers (snapshot:refresh, schematics:addActive,
// schematics:removeActive, characters:create) as part of the same handler,
// so verdicts stay in step with the data that drove them. Per advisor
// decision: no renderer-facing IPC for recompute itself; the renderer just
// queries `verdicts:list` after a mutation completes.
//
// One full pass for a typical SR2 snapshot (~700 resources × ~30 active
// schematics × ~5 raw slots × ~5 property groups) is on the order of 10ms
// — well under any user-perceptible latency budget.

import { and, desc, eq, inArray } from "drizzle-orm";
import { buildTypeAncestorMap, resourceTypeFitsRawSlot } from "../../core/verdict/compat";
import { matchTier, rollupResourceVerdict } from "../../core/verdict/rollup";
import { scoreGroup } from "../../core/verdict/score";
import type { ResourceStats, ScoredMatch, StatWeight } from "../../core/verdict/types";
import { getDb } from "../../db";
import {
  activeSchematics,
  characters,
  inventoryEntries,
  resourceObservations,
  resourceTypeGroups,
  resourceTypes,
  resources,
  schematicPropertyGroups,
  schematicPropertyWeights,
  schematicSlots,
  schematics,
  snapshots,
  verdicts,
} from "../../db/schema";

interface ActiveSchematicScoringContext {
  schematicId: string;
  schematicName: string;
  /** Only ingredientType === 0 slots; pre-filtered. */
  rawSlots: Array<{ slotName: string; ingredientObject: string }>;
  propertyGroups: Array<{
    id: number;
    propertyName: string | null;
    expGroup: string | null;
    weights: StatWeight[];
  }>;
  /** From active_schematics.source — informational, used in breakdown. */
  inheritedFromParent: boolean;
}

function statsFromRow(row: typeof resources.$inferSelect): ResourceStats {
  return {
    OQ: row.oq,
    CR: row.cr,
    CD: row.cd,
    DR: row.dr,
    FL: row.fl,
    HR: row.hr,
    MA: row.ma,
    PE: row.pe,
    SR: row.sr,
    UT: row.ut,
    ER: row.er,
  };
}

// (caps / floors helpers removed — universal-bounds scoring doesn't need
// per-type cap/floor inputs. The Resource Detail view still uses caps
// from the resource_types table for stat progress bars; that's queried
// separately in the resources:detail handler.)

/**
 * Build the per-character scoring context: every active schematic, with
 * its raw slots and property-group weights denormalised into memory.
 * Costs one query per table — schematics, slots, groups, weights.
 */
function buildActiveContext(characterId: string): ActiveSchematicScoringContext[] {
  const db = getDb();
  const activeRows = db
    .select()
    .from(activeSchematics)
    .where(eq(activeSchematics.characterId, characterId))
    .all();
  if (activeRows.length === 0) return [];

  const ids = activeRows.map((r) => r.schematicId);
  const schemRows = db.select().from(schematics).where(inArray(schematics.id, ids)).all();
  const schemById = new Map(schemRows.map((s) => [s.id, s]));

  const slotRows = db
    .select()
    .from(schematicSlots)
    .where(and(inArray(schematicSlots.schematicId, ids), eq(schematicSlots.ingredientType, 0)))
    .all();
  const slotsBySchematic = new Map<string, Array<{ slotName: string; ingredientObject: string }>>();
  for (const s of slotRows) {
    const arr = slotsBySchematic.get(s.schematicId) ?? [];
    arr.push({ slotName: s.slotName, ingredientObject: s.ingredientObject });
    slotsBySchematic.set(s.schematicId, arr);
  }

  const groupRows = db
    .select()
    .from(schematicPropertyGroups)
    .where(inArray(schematicPropertyGroups.schematicId, ids))
    .all();
  const groupsBySchematic = new Map<string, typeof groupRows>();
  for (const g of groupRows) {
    const arr = groupsBySchematic.get(g.schematicId) ?? [];
    arr.push(g);
    groupsBySchematic.set(g.schematicId, arr);
  }

  const groupIds = groupRows.map((g) => g.id);
  const weightRows =
    groupIds.length > 0
      ? db
          .select()
          .from(schematicPropertyWeights)
          .where(inArray(schematicPropertyWeights.groupId, groupIds))
          .all()
      : [];
  const weightsByGroup = new Map<number, StatWeight[]>();
  for (const w of weightRows) {
    const arr = weightsByGroup.get(w.groupId) ?? [];
    arr.push({ stat: w.stat, weight: w.weight });
    weightsByGroup.set(w.groupId, arr);
  }

  const ctx: ActiveSchematicScoringContext[] = [];
  for (const a of activeRows) {
    const s = schemById.get(a.schematicId);
    if (!s) continue;
    const rawSlots = slotsBySchematic.get(a.schematicId) ?? [];
    if (rawSlots.length === 0) continue; // no raw-resource slots → nothing to score for this schematic
    const groups = groupsBySchematic.get(a.schematicId) ?? [];
    const propertyGroups = groups
      .map((g) => ({
        id: g.id,
        propertyName: g.propertyName,
        expGroup: g.expGroup,
        weights: weightsByGroup.get(g.id) ?? [],
      }))
      // Filter to scoreable groups: must have weights, and at least one
      // weighted stat must be one of the 11 known stats. Drops the "null
      // weights / weightTotal 0" derived-property rows.
      .filter((g) => g.weights.length > 0);
    if (propertyGroups.length === 0) continue;
    ctx.push({
      schematicId: a.schematicId,
      schematicName: s.name,
      rawSlots,
      propertyGroups,
      inheritedFromParent: a.source === "inherited",
    });
  }
  return ctx;
}

export interface RecomputeResult {
  characterId: string;
  snapshotId: string;
  resourcesScored: number;
  verdictsWritten: number;
  chase: number;
  maybe: number;
  /** Inventory rows that contributed to ownedBestScore. */
  inventoryEntries: number;
  /** Number of (resource × schematic × property-group) matches where scoreOwned > 0. */
  inventorySeededMatches: number;
  durationMs: number;
}

/**
 * Recompute and persist the full per-resource verdict set for one
 * character against the latest snapshot of their galaxy. If the character
 * has no active schematics OR no snapshot exists yet, the verdicts table
 * is cleared (defensively) and the function returns 0 counts.
 *
 * Safe to call inside an IPC handler — opens its own transaction for the
 * write phase. Read phase is non-transactional (acceptable: the inputs
 * are committed by the calling handler before this function runs).
 */
export function recomputeVerdicts(characterId: string): RecomputeResult {
  const start = Date.now();
  const db = getDb();
  const char = db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!char) throw new Error(`recomputeVerdicts: character not found: ${characterId}`);

  const latestSnapshot = db
    .select()
    .from(snapshots)
    .where(eq(snapshots.galaxyId, char.galaxyId))
    .orderBy(desc(snapshots.fetchedAt))
    .limit(1)
    .get();
  if (!latestSnapshot) {
    return {
      characterId,
      snapshotId: "",
      resourcesScored: 0,
      verdictsWritten: 0,
      chase: 0,
      maybe: 0,
      inventoryEntries: 0,
      inventorySeededMatches: 0,
      durationMs: Date.now() - start,
    };
  }

  // Scope all delete predicates to (character, current snapshot) so a future
  // historical-verdict feature (despawn diff, snapshot replay) doesn't lose
  // its trail. Phase 3 never writes verdicts for any other snapshot, so this
  // is currently identical in effect to character-wide delete, but the
  // narrower predicate is the right contract to lock in now.
  const clearCurrent = (): void => {
    getDb()
      .delete(verdicts)
      .where(
        and(eq(verdicts.characterId, characterId), eq(verdicts.snapshotId, latestSnapshot.id)),
      )
      .run();
  };

  const activeCtx = buildActiveContext(characterId);
  // Clear current-snapshot verdicts so the table reflects only current
  // state. We do this even when active list is empty.
  if (activeCtx.length === 0) {
    clearCurrent();
    return {
      characterId,
      snapshotId: latestSnapshot.id,
      resourcesScored: 0,
      verdictsWritten: 0,
      chase: 0,
      maybe: 0,
      inventoryEntries: 0,
      inventorySeededMatches: 0,
      durationMs: Date.now() - start,
    };
  }

  // Load resources observed in the latest snapshot.
  const obsRows = db
    .select()
    .from(resourceObservations)
    .where(eq(resourceObservations.snapshotId, latestSnapshot.id))
    .all();
  const resourceIdsInSnapshot = obsRows.map((r) => r.resourceId);
  if (resourceIdsInSnapshot.length === 0) {
    clearCurrent();
    return {
      characterId,
      snapshotId: latestSnapshot.id,
      resourcesScored: 0,
      verdictsWritten: 0,
      chase: 0,
      maybe: 0,
      inventoryEntries: 0,
      inventorySeededMatches: 0,
      durationMs: Date.now() - start,
    };
  }

  const resourceRows = db
    .select()
    .from(resources)
    .where(inArray(resources.id, resourceIdsInSnapshot))
    .all();

  // Resource-type lookup (caps/floors). Build once.
  const typeIds = Array.from(new Set(resourceRows.map((r) => r.typeId)));
  const typeRows = db.select().from(resourceTypes).where(inArray(resourceTypes.id, typeIds)).all();
  const typeById = new Map(typeRows.map((t) => [t.id, t]));

  // Build ownedBestScore: for each (schematic, propertyGroup) pair on the
  // active list, the highest score among the character's currently-owned
  // resources of compatible type. Empty map (or 0 lookups) = empty-
  // inventory path in matchTier, which preserves Phase 3 behaviour.
  //
  // Owned resources may not be in the current snapshot (e.g. despawned); load
  // them by ID separately. Union those typeIds with the snapshot typeIds
  // when fetching the type-ancestor edge subset below.
  const inventoryRows = db
    .select()
    .from(inventoryEntries)
    .where(eq(inventoryEntries.characterId, characterId))
    .all();
  const ownedResourceIds = inventoryRows.map((i) => i.resourceId);
  const ownedResourceRows =
    ownedResourceIds.length > 0
      ? db.select().from(resources).where(inArray(resources.id, ownedResourceIds)).all()
      : [];
  const ownedTypeIds = ownedResourceRows.map((r) => r.typeId);
  const allTypeIds = Array.from(new Set([...typeIds, ...ownedTypeIds]));

  // Type-row lookup: extend with any owned types not already in typeById
  // (owned-but-not-spawning resources may reference types absent from the
  // snapshot's type set).
  const missingOwnedTypeIds = ownedTypeIds.filter((id) => !typeById.has(id));
  if (missingOwnedTypeIds.length > 0) {
    const extraTypeRows = db
      .select()
      .from(resourceTypes)
      .where(inArray(resourceTypes.id, missingOwnedTypeIds))
      .all();
    for (const t of extraTypeRows) typeById.set(t.id, t);
  }

  // Type→ancestor edges. Pull the union — covers both candidate resources
  // (current snapshot) and owned resources (may be despawned / not spawning).
  const tgEdges = db
    .select()
    .from(resourceTypeGroups)
    .where(inArray(resourceTypeGroups.typeId, allTypeIds))
    .all();
  const typeAncestors = buildTypeAncestorMap(tgEdges);

  // Compute ownedBest by walking each owned resource against the active
  // context. Same compat + scoring path as the candidate loop below; this
  // is the only place inventory enters the formula. Reserved-status entries
  // are included — they're still owned, just earmarked elsewhere; their
  // existence still raises the bar for "is a new spawn worth pursuing."
  const ownedBestScore = new Map<string, number>();
  for (const owned of ownedResourceRows) {
    const tr = typeById.get(owned.typeId);
    if (!tr) continue; // owned resource of a type the reference data doesn't know — skip
    const stats = statsFromRow(owned);
    for (const ctx of activeCtx) {
      const fits = ctx.rawSlots.some((s) =>
        resourceTypeFitsRawSlot(owned.typeId, s.ingredientObject, typeAncestors),
      );
      if (!fits) continue;
      for (const g of ctx.propertyGroups) {
        const score = scoreGroup(stats, g.weights);
        if (score === null) continue;
        const key = `${ctx.schematicId}|${g.id}`;
        const prev = ownedBestScore.get(key) ?? 0;
        if (score > prev) ownedBestScore.set(key, score);
      }
    }
  }

  // Score every resource against every active-schematic scoring context.
  const verdictRows: Array<typeof verdicts.$inferInsert> = [];
  let chaseCount = 0;
  let maybeCount = 0;
  let invSeededMatches = 0; // count of matches where scoreOwned > 0 (diagnostic)
  const now = Date.now();

  for (const r of resourceRows) {
    const tr = typeById.get(r.typeId);
    if (!tr) continue; // Resource of a type the reference data doesn't know — skip.

    const stats = statsFromRow(r);

    const matches: ScoredMatch[] = [];
    for (const ctx of activeCtx) {
      // Does the resource's type fit ANY raw slot on this schematic?
      const fits = ctx.rawSlots.some((s) =>
        resourceTypeFitsRawSlot(r.typeId, s.ingredientObject, typeAncestors),
      );
      if (!fits) continue;

      // For each property group on this schematic, score against the resource.
      for (const g of ctx.propertyGroups) {
        const score = scoreGroup(stats, g.weights);
        if (score === null) continue;
        const scoreOwned = ownedBestScore.get(`${ctx.schematicId}|${g.id}`) ?? 0;
        if (scoreOwned > 0) invSeededMatches++;
        matches.push({
          schematicId: ctx.schematicId,
          schematicName: ctx.schematicName,
          propertyGroupId: g.id,
          propertyName: g.propertyName,
          expGroup: g.expGroup,
          score,
          scoreOwned,
          tier: matchTier(score, scoreOwned),
          inheritedFromParent: ctx.inheritedFromParent,
        });
      }
    }

    const verdict = rollupResourceVerdict(matches);
    if (!verdict) continue;
    if (verdict.tier === "CHASE") chaseCount++;
    else if (verdict.tier === "MAYBE") maybeCount++;
    verdictRows.push({
      resourceId: r.id,
      characterId,
      snapshotId: latestSnapshot.id,
      tier: verdict.tier,
      reason: verdict.reason,
      topScore: verdict.topScore,
      matchedSchematicCount: verdict.matchedSchematicCount,
      breakdownJson: JSON.stringify(verdict.breakdown),
      computedAt: now,
    });
  }

  // Atomic swap: clear current-snapshot verdicts, insert new. The transaction
  // is the integrity boundary if anything throws mid-insert. Predicate scoped
  // to current snapshot only (see clearCurrent rationale above).
  db.transaction((tx) => {
    tx.delete(verdicts)
      .where(and(eq(verdicts.characterId, characterId), eq(verdicts.snapshotId, latestSnapshot.id)))
      .run();
    for (const row of verdictRows) {
      tx.insert(verdicts).values(row).run();
    }
  });

  return {
    characterId,
    snapshotId: latestSnapshot.id,
    resourcesScored: resourceRows.length,
    verdictsWritten: verdictRows.length,
    chase: chaseCount,
    maybe: maybeCount,
    inventoryEntries: inventoryRows.length,
    inventorySeededMatches: invSeededMatches,
    durationMs: Date.now() - start,
  };
}
