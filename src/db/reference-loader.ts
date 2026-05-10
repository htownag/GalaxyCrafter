// Loads bundled reference-data JSON files into the DB at app startup.
// Hash-compares against `reference_meta` table; skips reload when the file
// hasn't changed since last successful load.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "./index";
import {
  referenceMeta,
  resourceGroups,
  resourceTypeGroups,
  resourceTypes,
  schematicDependencies,
  schematicPropertyGroups,
  schematicPropertyWeights,
  schematicSlots,
  schematics,
} from "./schema";

interface Provenance {
  generated: string;
  source: string;
  sourceCommit: string;
  importer: string;
}

interface ResourceTypeJson {
  id: string;
  name: string;
  groupId: string;
  parentGroup: string;
  caps: Record<string, number>;
  floors: Record<string, number>;
}

interface ResourceGroupJson {
  id: string;
  name: string;
  depth: number;
  parentCategory: string | null;
}

interface TypeGroupEdgeJson {
  typeId: string;
  groupId: string;
}

interface SchematicJson {
  id: string;
  name: string;
  objectType: number;
  skillGroup: string | null;
  craftingTabBitmask: number;
  craftingTab: string | null;
  complexity: number;
  objectSize: number;
  xpType: string | null;
  xpAmount: number;
  objectPath: string;
  parentObjectPath: string;
  slots: Array<{
    slotName: string;
    ingredientType: number;
    ingredientObject: string;
    unitsRequired: number;
    contribution: number;
  }>;
  propertyGroups: Array<{
    id: number;
    propertyName: string | null;
    expGroup: string | null;
    weightTotal: number;
    weights: Array<{ stat: string; weight: number }>;
  }>;
}

interface DependencyJson {
  parentSchematicId: string;
  childSchematicId: string;
  slotName: string;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function isStale(source: string, contentHash: string): boolean {
  const db = getDb();
  const row = db.select().from(referenceMeta).where(eq(referenceMeta.source, source)).get();
  if (!row) return true;
  return row.contentHash !== contentHash;
}

function markLoaded(source: string, contentHash: string, rowCount: number): void {
  const db = getDb();
  const now = Date.now();
  const existing = db.select().from(referenceMeta).where(eq(referenceMeta.source, source)).get();
  if (existing) {
    db.update(referenceMeta)
      .set({ contentHash, loadedAt: now, rowCount })
      .where(eq(referenceMeta.source, source))
      .run();
  } else {
    db.insert(referenceMeta).values({ source, contentHash, loadedAt: now, rowCount }).run();
  }
}

function loadResourceTypes(appRoot: string): void {
  const filePath = path.join(appRoot, "reference-data", "resource-types.json");
  const raw = readFileSync(filePath, "utf8");
  const hash = sha256(raw);
  if (!isStale("resource-types", hash)) {
    console.log("[ref] resource-types up to date — skipping reload");
    return;
  }
  const parsed = JSON.parse(raw) as {
    provenance: Provenance;
    types: ResourceTypeJson[];
    resourceGroups?: ResourceGroupJson[];
    typeGroupEdges?: TypeGroupEdgeJson[];
  };
  const groupsList = parsed.resourceGroups ?? [];
  const edgesList = parsed.typeGroupEdges ?? [];
  console.log(
    `[ref] loading ${parsed.types.length} resource types + ${groupsList.length} groups + ${edgesList.length} type-group edges (source: ${parsed.provenance.sourceCommit})`,
  );

  // Pre-filter type-group edges against known type/group IDs so an upstream
  // GH data drift doesn't punch holes through the loader.
  const typeIdSet = new Set(parsed.types.map((t) => t.id));
  const groupIdSet = new Set(groupsList.map((g) => g.id));
  const validEdges = edgesList.filter((e) => typeIdSet.has(e.typeId) && groupIdSet.has(e.groupId));
  const droppedEdges = edgesList.length - validEdges.length;
  if (droppedEdges > 0) {
    console.warn(`[ref] dropped ${droppedEdges} type-group edges with unknown referents`);
  }

  const db = getDb();
  db.transaction((tx) => {
    // Order matters when FKs are enforced — but better-sqlite3 defaults to
    // off. We still order deletes child-first for clarity.
    tx.delete(resourceTypeGroups).run();
    tx.delete(resourceGroups).run();
    tx.delete(resourceTypes).run();
    for (const t of parsed.types) {
      tx.insert(resourceTypes)
        .values({
          id: t.id,
          name: t.name,
          groupId: t.groupId,
          parentGroup: t.parentGroup,
          capOq: t.caps.OQ ?? 0,
          capCr: t.caps.CR ?? 0,
          capCd: t.caps.CD ?? 0,
          capDr: t.caps.DR ?? 0,
          capFl: t.caps.FL ?? 0,
          capHr: t.caps.HR ?? 0,
          capMa: t.caps.MA ?? 0,
          capPe: t.caps.PE ?? 0,
          capSr: t.caps.SR ?? 0,
          capUt: t.caps.UT ?? 0,
          capEr: t.caps.ER ?? 0,
          floorOq: t.floors.OQ ?? 0,
          floorCr: t.floors.CR ?? 0,
          floorCd: t.floors.CD ?? 0,
          floorDr: t.floors.DR ?? 0,
          floorFl: t.floors.FL ?? 0,
          floorHr: t.floors.HR ?? 0,
          floorMa: t.floors.MA ?? 0,
          floorPe: t.floors.PE ?? 0,
          floorSr: t.floors.SR ?? 0,
          floorUt: t.floors.UT ?? 0,
          floorEr: t.floors.ER ?? 0,
        })
        .run();
    }
    for (const g of groupsList) {
      tx.insert(resourceGroups)
        .values({
          id: g.id,
          name: g.name,
          depth: g.depth,
          parentCategory: g.parentCategory,
        })
        .run();
    }
    for (const e of validEdges) {
      tx.insert(resourceTypeGroups).values({ typeId: e.typeId, groupId: e.groupId }).run();
    }
  });
  markLoaded("resource-types", hash, parsed.types.length + groupsList.length + validEdges.length);
}

function loadSchematics(appRoot: string): void {
  const filePath = path.join(appRoot, "reference-data", "schematics.json");
  const raw = readFileSync(filePath, "utf8");
  const hash = sha256(raw);
  if (!isStale("schematics", hash)) {
    console.log("[ref] schematics up to date — skipping reload");
    return;
  }
  const parsed = JSON.parse(raw) as {
    provenance: Provenance;
    schematics: SchematicJson[];
    dependencies: DependencyJson[];
  };
  console.log(
    `[ref] loading ${parsed.schematics.length} schematics + ${parsed.dependencies.length} dep edges (source: ${parsed.provenance.sourceCommit})`,
  );
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(schematicPropertyWeights).run();
    tx.delete(schematicPropertyGroups).run();
    tx.delete(schematicSlots).run();
    tx.delete(schematicDependencies).run();
    tx.delete(schematics).run();

    for (const s of parsed.schematics) {
      tx.insert(schematics)
        .values({
          id: s.id,
          name: s.name,
          objectType: s.objectType,
          skillGroup: s.skillGroup,
          craftingTabBitmask: s.craftingTabBitmask,
          craftingTab: s.craftingTab,
          complexity: s.complexity,
          objectSize: s.objectSize,
          xpType: s.xpType,
          xpAmount: s.xpAmount,
          objectPath: s.objectPath,
          parentObjectPath: s.parentObjectPath,
        })
        .run();

      for (const slot of s.slots) {
        tx.insert(schematicSlots)
          .values({
            schematicId: s.id,
            slotName: slot.slotName,
            ingredientType: slot.ingredientType,
            ingredientObject: slot.ingredientObject,
            unitsRequired: slot.unitsRequired,
            contribution: slot.contribution,
          })
          .run();
      }

      for (const g of s.propertyGroups) {
        tx.insert(schematicPropertyGroups)
          .values({
            id: g.id,
            schematicId: s.id,
            propertyName: g.propertyName,
            expGroup: g.expGroup,
            weightTotal: g.weightTotal,
          })
          .run();
        for (const w of g.weights) {
          tx.insert(schematicPropertyWeights)
            .values({ groupId: g.id, stat: w.stat, weight: w.weight })
            .run();
        }
      }
    }

    for (const d of parsed.dependencies) {
      tx.insert(schematicDependencies)
        .values({
          parentSchematicId: d.parentSchematicId,
          childSchematicId: d.childSchematicId,
          slotName: d.slotName,
        })
        .run();
    }
  });
  markLoaded("schematics", hash, parsed.schematics.length);
}

/**
 * Run at app startup after `initDb()`. Loads any reference-data file whose
 * SHA-256 has changed since last successful load.
 */
export function loadReferenceData(appRoot: string): void {
  console.log("[ref] checking reference-data freshness");
  loadResourceTypes(appRoot);
  loadSchematics(appRoot);
  console.log("[ref] reference data ready");
}
