// Server-best (SB) flag computation per design doc §5.2.7.
//
// Orthogonal to the personal verdict engine — a resource can be SKIP
// for your craft list AND `SB_TOP_for_Bio_Engineer` (collectible /
// market value) at the same time. The SB lane answers "rare and valuable
// by independent measure" across the FULL bundled schematic library,
// regardless of which schematics the player has on their active list.
//
// Computation (per profession):
//   1. For each schematic with that profession's skill group:
//      For each scoreable property group on the schematic:
//        For each spawning resource that fits a raw slot:
//          score it.
//          Track max score within (profession, schematic, propertyGroup).
//   2. Classify each resource per profession:
//      - SB_TOP_for_<P>:  resource achieved max on ≥1 (schematic, group)
//                         for that profession.
//      - SB_NEAR_for_<P>: not SB_TOP, but reached ≥95% of max on ≥1
//                         (schematic, group) for that profession.
//   3. Persist per (resource, snapshot, profession, tier). Tracking the
//      best-producing schematic on each flag lets the UI drill down.
//
// Cost: ~700 resources × ~1700 schematics × ~5 property groups × O(1)
// score = ~6M scoreGroup calls per snapshot. Pure math + maps, JIT-friendly,
// observed ~1-2s on Mauryll's SR2 snapshot — fires once per snapshot
// (inside the ingest pipeline), not per character mutation.

import { and, eq, inArray } from "drizzle-orm";
import { buildTypeAncestorMap, resourceTypeFitsRawSlot } from "../../core/verdict/compat";
import { scoreGroup } from "../../core/verdict/score";
import type { ResourceStats, StatWeight } from "../../core/verdict/types";
import { getDb } from "../../db";
import {
  resourceObservations,
  resourceTypeGroups,
  resources,
  sbFlags,
  schematicPropertyGroups,
  schematicPropertyWeights,
  schematicSlots,
  schematics,
} from "../../db/schema";
import { PROFESSIONS, professionForSkillGroup } from "../../shared/professions";

const NEAR_THRESHOLD = 0.95;

export interface SbComputeResult {
  snapshotId: string;
  galaxyId: number;
  resourcesScored: number;
  schematicsConsidered: number;
  topFlags: number;
  nearFlags: number;
  durationMs: number;
}

/**
 * Compute SB flags for every spawning resource on the given snapshot,
 * across all 8 crafting professions and the full bundled schematic
 * library. Atomically swaps the snapshot's sb_flags rows.
 */
export function recomputeSbFlagsForSnapshot(
  galaxyId: number,
  snapshotId: string,
): SbComputeResult {
  const start = Date.now();
  const db = getDb();

  // Load every spawning resource in the snapshot.
  const obsRows = db
    .select()
    .from(resourceObservations)
    .where(eq(resourceObservations.snapshotId, snapshotId))
    .all();
  const resourceIds = obsRows.map((o) => o.resourceId);
  if (resourceIds.length === 0) {
    db.delete(sbFlags).where(eq(sbFlags.snapshotId, snapshotId)).run();
    return {
      snapshotId,
      galaxyId,
      resourcesScored: 0,
      schematicsConsidered: 0,
      topFlags: 0,
      nearFlags: 0,
      durationMs: Date.now() - start,
    };
  }

  const resourceRows = db.select().from(resources).where(inArray(resources.id, resourceIds)).all();

  // Build type→ancestor map limited to the types in this snapshot.
  const typeIds = Array.from(new Set(resourceRows.map((r) => r.typeId)));
  const tgEdges = db
    .select()
    .from(resourceTypeGroups)
    .where(inArray(resourceTypeGroups.typeId, typeIds))
    .all();
  const typeAncestors = buildTypeAncestorMap(tgEdges);

  // Pre-convert resource rows to (id, typeId, stats) tuples for cheap inner loops.
  const candidates: Array<{ id: string; typeId: string; stats: ResourceStats }> =
    resourceRows.map((r) => ({
      id: r.id,
      typeId: r.typeId,
      stats: {
        OQ: r.oq, CR: r.cr, CD: r.cd, DR: r.dr, FL: r.fl, HR: r.hr,
        MA: r.ma, PE: r.pe, SR: r.sr, UT: r.ut, ER: r.er,
      },
    }));

  // Load all schematics with a recognisable profession + at least one
  // raw-resource slot (otherwise no resource scores apply). Plus their
  // raw slots and scoreable property groups.
  const allSchematics = db.select().from(schematics).all();
  const schematicsByProfession = new Map<string, typeof allSchematics>();
  for (const s of allSchematics) {
    const prof = professionForSkillGroup(s.skillGroup);
    if (!prof) continue;
    const arr = schematicsByProfession.get(prof) ?? [];
    arr.push(s);
    schematicsByProfession.set(prof, arr);
  }

  const relevantSchematicIds = allSchematics
    .filter((s) => professionForSkillGroup(s.skillGroup) !== null)
    .map((s) => s.id);
  if (relevantSchematicIds.length === 0) {
    db.delete(sbFlags).where(eq(sbFlags.snapshotId, snapshotId)).run();
    return {
      snapshotId,
      galaxyId,
      resourcesScored: resourceRows.length,
      schematicsConsidered: 0,
      topFlags: 0,
      nearFlags: 0,
      durationMs: Date.now() - start,
    };
  }

  // Raw slots only (ingredientType=0). Bulk-load + group by schematic.
  const slotRows = db
    .select()
    .from(schematicSlots)
    .where(
      and(
        inArray(schematicSlots.schematicId, relevantSchematicIds),
        eq(schematicSlots.ingredientType, 0),
      ),
    )
    .all();
  const slotsBySchematic = new Map<string, Array<{ ingredientObject: string }>>();
  for (const slot of slotRows) {
    const arr = slotsBySchematic.get(slot.schematicId) ?? [];
    arr.push({ ingredientObject: slot.ingredientObject });
    slotsBySchematic.set(slot.schematicId, arr);
  }

  // Property groups + weights.
  const groupRows = db
    .select()
    .from(schematicPropertyGroups)
    .where(inArray(schematicPropertyGroups.schematicId, relevantSchematicIds))
    .all();
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
  const propsBySchematic = new Map<
    string,
    Array<{ id: number; weights: StatWeight[] }>
  >();
  for (const g of groupRows) {
    const weights = weightsByGroup.get(g.id) ?? [];
    if (weights.length === 0) continue; // unscoreable derived property
    const arr = propsBySchematic.get(g.schematicId) ?? [];
    arr.push({ id: g.id, weights });
    propsBySchematic.set(g.schematicId, arr);
  }

  // ===== Main compute =====
  //
  // For each (profession, schematic, propertyGroup):
  //   For each candidate that fits a raw slot on this schematic:
  //     score it.
  //     Track max score for this key (used to classify TOP/NEAR per
  //     resource later).
  //     Record the resource's per-(profession, schematic, group) score.
  //
  // After: classify each resource per profession by comparing its best
  // score in that profession vs the profession's per-(schematic, group)
  // max scores.

  // resourceProfessionBest: resource → profession → { best score so far,
  // best schematicId producing it }
  const resourceProfessionBest = new Map<
    string,
    Map<string, { score: number; schematicId: string }>
  >();
  // For each (profession, schematic, propertyGroup), the resource score
  // bar that defines SB_TOP (max) and SB_NEAR floor (0.95 × max).
  const keyMax = new Map<string, number>();

  for (const [profession, schemArr] of schematicsByProfession) {
    for (const schem of schemArr) {
      const rawSlots = slotsBySchematic.get(schem.id);
      if (!rawSlots || rawSlots.length === 0) continue;
      const props = propsBySchematic.get(schem.id);
      if (!props || props.length === 0) continue;

      for (const cand of candidates) {
        // Compat: does cand's type fit ANY raw slot on this schematic?
        const fits = rawSlots.some((s) =>
          resourceTypeFitsRawSlot(cand.typeId, s.ingredientObject, typeAncestors),
        );
        if (!fits) continue;

        for (const pg of props) {
          const score = scoreGroup(cand.stats, pg.weights);
          if (score === null) continue;

          // Track per-key max (used for SB_TOP / SB_NEAR threshold)
          const key = `${profession}|${schem.id}|${pg.id}`;
          const prevMax = keyMax.get(key) ?? -Infinity;
          if (score > prevMax) keyMax.set(key, score);

          // Track per-resource best per profession (the schematic id that
          // produced the best score is what we record on the flag)
          let perProf = resourceProfessionBest.get(cand.id);
          if (!perProf) {
            perProf = new Map();
            resourceProfessionBest.set(cand.id, perProf);
          }
          const prev = perProf.get(profession);
          if (!prev || score > prev.score) {
            perProf.set(profession, { score, schematicId: schem.id });
          }
        }
      }
    }
  }

  // For SB classification we need to know, per (profession, schematic,
  // propGroup), the max score across all candidates. We have that in
  // keyMax. But we also need to know, per (profession), the max score
  // any (schematic, propGroup) reaches — so a resource SB_TOP-qualifies
  // if it matches keyMax on ANY (sch, pg) in its best profession.
  //
  // Simpler restatement: for each (resource, profession), tier is:
  //   SB_TOP if resource.score on its best (sch, pg) == keyMax[that key]
  //   SB_NEAR if not SB_TOP but resource.score >= 0.95 × keyMax[its best key]
  //   (no flag) otherwise
  //
  // Subtle: keyMax stores the max across all candidates including this
  // resource itself — so equality is the natural top check.

  const flagRows: Array<typeof sbFlags.$inferInsert> = [];
  let topCount = 0;
  let nearCount = 0;

  for (const [resourceId, perProf] of resourceProfessionBest) {
    for (const [profession, best] of perProf) {
      // We need the per-(profession, schematic, propGroup) key — but we
      // only recorded the schematic on the resource's best result, not
      // the property group. Rebuild: scan props on best.schematicId, find
      // the one where this resource scored == best.score (within float
      // tolerance), use its keyMax.
      const props = propsBySchematic.get(best.schematicId) ?? [];
      const cand = candidates.find((c) => c.id === resourceId);
      if (!cand) continue;
      let propTopMax = 0;
      let propGroupId: number | null = null;
      for (const pg of props) {
        const s = scoreGroup(cand.stats, pg.weights);
        if (s === null) continue;
        if (Math.abs(s - best.score) < 1e-6) {
          // This is the property group producing the resource's best score
          // in this profession. Use its keyMax for top/near classification.
          const m = keyMax.get(`${profession}|${best.schematicId}|${pg.id}`) ?? best.score;
          propTopMax = m;
          propGroupId = pg.id;
          break;
        }
      }
      if (propGroupId === null) continue;

      const isTop = Math.abs(best.score - propTopMax) < 1e-6;
      const isNear = !isTop && best.score >= NEAR_THRESHOLD * propTopMax;
      if (!isTop && !isNear) continue;

      flagRows.push({
        resourceId,
        snapshotId,
        forProfession: profession,
        tier: isTop ? "SB_TOP" : "SB_NEAR",
        score: best.score,
        topScoreOnSnapshot: propTopMax,
        schematicId: best.schematicId,
      });
      if (isTop) topCount++;
      else nearCount++;
    }
  }

  db.transaction((tx) => {
    tx.delete(sbFlags).where(eq(sbFlags.snapshotId, snapshotId)).run();
    for (const row of flagRows) tx.insert(sbFlags).values(row).run();
  });

  return {
    snapshotId,
    galaxyId,
    resourcesScored: resourceRows.length,
    schematicsConsidered: relevantSchematicIds.length,
    topFlags: topCount,
    nearFlags: nearCount,
    durationMs: Date.now() - start,
  };
}

// Re-export for callers that want a single import.
export { PROFESSIONS };
