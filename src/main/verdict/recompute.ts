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
import {
  DEFAULT_THRESHOLDS,
  matchTier,
  rollupResourceVerdict,
  type VerdictThresholds,
} from "../../core/verdict/rollup";
import { scoreGroup } from "../../core/verdict/score";
import type { ResourceStats, ScoredMatch, StatWeight } from "../../core/verdict/types";
import {
  type ActiveSlot,
  computeResourceUnlocks,
  computeUncoveredSlots,
  type UnlockEntry,
} from "../../core/verdict/unlock";
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
  settings,
  snapshots,
  verdicts,
} from "../../db/schema";

/**
 * Pull verdict-threshold overrides from the settings table. Each key
 * `verdict.<field>` is checked individually; absent / non-numeric values
 * fall back to the corresponding DEFAULT_THRESHOLDS field. So a player can
 * override one knob without resetting the others.
 */
export function loadVerdictThresholds(): VerdictThresholds {
  const db = getDb();
  const rows = db.select().from(settings).all();
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  function num(key: keyof VerdictThresholds, fallback: number): number {
    const raw = byKey.get(`verdict.${key}`);
    if (raw === undefined || raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }
  return {
    absChase: num("absChase", DEFAULT_THRESHOLDS.absChase),
    absMaybe: num("absMaybe", DEFAULT_THRESHOLDS.absMaybe),
    deltaChase: num("deltaChase", DEFAULT_THRESHOLDS.deltaChase),
    deltaMaybe: num("deltaMaybe", DEFAULT_THRESHOLDS.deltaMaybe),
    highScoreChase: num("highScoreChase", DEFAULT_THRESHOLDS.highScoreChase),
    highScoreMaybe: num("highScoreMaybe", DEFAULT_THRESHOLDS.highScoreMaybe),
  };
}

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
  /** v0.1.6: count of uncovered raw slots across active schematics (live+reserved inventory only). */
  uncoveredSlots: number;
  /** v0.1.6: count of verdict rows where unlocks_any=1. */
  unlockResources: number;
  durationMs: number;
}

// UnlockEntry/ActiveSlot live in src/core/verdict/unlock.ts so the pure
// coverage math can be unit-tested without a DB. Re-imported above.

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

  // Pull thresholds from settings once per recompute. Threading them through
  // matchTier downstream so per-match decisions honor the player's overrides.
  const thresholds = loadVerdictThresholds();

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
      uncoveredSlots: 0,
      unlockResources: 0,
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
      uncoveredSlots: 0,
      unlockResources: 0,
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
      uncoveredSlots: 0,
      unlockResources: 0,
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

  // ============================================================
  // v0.1.6 UNLOCK — per-character slot-coverage map
  // ============================================================
  //
  // A raw slot on an active schematic is COVERED iff the player owns ≥1 unit
  // of a fitting type, REGARDLESS OF STATUS (live, reserved, OR despawned).
  //
  // v0.1.8 reverted the v0.1.6 "despawned doesn't cover" rule. The original
  // call was that despawned is a draining bucket and UNLOCK should fire to
  // remind the player to replenish. Real-world evidence contradicted it:
  // Ryan's actual stashes are 30,000+ units of despawned material — orders
  // of magnitude more than any single craft consumes. UNLOCK firing on
  // those families just clutters the lane with spawns he doesn't need to
  // grab. Listen to the user's actual usage > the hypothetical walkthrough.
  //
  // If "you should replenish drainable stashes" becomes important later,
  // that's a separate REORDER lane (units-below-threshold), not an
  // overload of UNLOCK. See design-unlock-tier.md §Q2 v0.1.8 errata.
  //
  // uncoveredSlots is the unique list of slots across all active schematics
  // that currently lack any covering inventory; UNLOCK fires on a candidate
  // resource iff its type fits at least one of these slots. The pure
  // coverage math lives in src/core/verdict/unlock.ts so it can be unit-
  // tested without a DB; this orchestrator just feeds it the inputs.
  const ownedResourceById = new Map(ownedResourceRows.map((r) => [r.id, r]));
  const coveringTypeIds = new Set<string>();
  for (const inv of inventoryRows) {
    const ownedRow = ownedResourceById.get(inv.resourceId);
    if (ownedRow) coveringTypeIds.add(ownedRow.typeId);
  }

  const allActiveSlots: ActiveSlot[] = [];
  for (const ctx of activeCtx) {
    for (const slot of ctx.rawSlots) {
      allActiveSlots.push({
        schematicId: ctx.schematicId,
        schematicName: ctx.schematicName,
        slotName: slot.slotName,
        ingredientObject: slot.ingredientObject,
      });
    }
  }
  const fitsSlot = (typeId: string, ingredientObject: string): boolean =>
    resourceTypeFitsRawSlot(typeId, ingredientObject, typeAncestors);
  const uncoveredSlots: UnlockEntry[] = computeUncoveredSlots(
    allActiveSlots,
    coveringTypeIds,
    fitsSlot,
  );

  // Score every resource against every active-schematic scoring context.
  const verdictRows: Array<typeof verdicts.$inferInsert> = [];
  let chaseCount = 0;
  let maybeCount = 0;
  let invSeededMatches = 0; // count of matches where scoreOwned > 0 (diagnostic)
  let unlockResourcesCount = 0;
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
          tier: matchTier(score, scoreOwned, thresholds),
          inheritedFromParent: ctx.inheritedFromParent,
        });
      }
    }

    // v0.1.6 UNLOCK: which currently-uncovered slots does this resource fit?
    // Computed independent of quality — a SKIP-tier resource still gets
    // UNLOCK flagged. The list is persisted as JSON so the UI can show
    // "this resource unlocks T21 Stock + DH17 Power Handler."
    const unlocks = computeResourceUnlocks(r.typeId, uncoveredSlots, fitsSlot);
    const unlocksAny = unlocks.length > 0;

    const verdict = rollupResourceVerdict(matches);

    // Three cases for whether to write a verdict row:
    //   1. Rollup returns CHASE/MAYBE → always write.
    //   2. Rollup returns null (resource didn't fit any slot OR all matches SKIP)
    //      AND unlocksAny is true → write a SKIP-with-UNLOCK row so the UI can
    //      surface the stockpile-builder case. Reason is UNLOCK-flavored.
    //   3. Rollup returns null AND unlocksAny is false → skip, not on radar.
    if (!verdict && !unlocksAny) continue;

    if (verdict) {
      if (verdict.tier === "CHASE") chaseCount++;
      else if (verdict.tier === "MAYBE") maybeCount++;
      if (unlocksAny) unlockResourcesCount++;
      verdictRows.push({
        resourceId: r.id,
        characterId,
        snapshotId: latestSnapshot.id,
        tier: verdict.tier,
        reason: verdict.reason,
        topScore: verdict.topScore,
        matchedSchematicCount: verdict.matchedSchematicCount,
        breakdownJson: JSON.stringify(verdict.breakdown),
        unlocksAny: unlocksAny ? 1 : 0,
        unlocksJson: unlocksAny ? JSON.stringify(unlocks) : null,
        computedAt: now,
      });
    } else {
      // UNLOCK-only path: synthesize a SKIP row so the resource surfaces
      // on UNLOCK-driven views (Dashboard "Unlocks needed" lane, Resources
      // tab UNLOCK filter, Resource detail page). Tier stays SKIP because
      // quality really is below thresholds; UNLOCK is the orthogonal lane.
      unlockResourcesCount++;
      const top = matches.length > 0 ? [...matches].sort((a, b) => b.score - a.score)[0] : null;
      const matchedIds = new Set(matches.map((m) => m.schematicId));
      const unlocksLabel =
        unlocks.length === 1 ? "1 uncovered slot" : `${unlocks.length} uncovered slots`;
      const reason = top
        ? `${top.score.toFixed(1)} on ${top.schematicName} — UNLOCKS ${unlocksLabel}`
        : `UNLOCKS ${unlocksLabel}`;
      verdictRows.push({
        resourceId: r.id,
        characterId,
        snapshotId: latestSnapshot.id,
        tier: "SKIP",
        reason,
        topScore: top?.score ?? 0,
        matchedSchematicCount: matchedIds.size,
        breakdownJson: JSON.stringify(matches),
        unlocksAny: 1,
        unlocksJson: JSON.stringify(unlocks),
        computedAt: now,
      });
    }
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
    uncoveredSlots: uncoveredSlots.length,
    unlockResources: unlockResourcesCount,
    durationMs: Date.now() - start,
  };
}
