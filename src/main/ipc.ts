import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { BrowserWindow, ipcMain } from "electron";
import galaxiesConfig from "../../reference-data/galaxies.json";
import { getDb } from "../db";
import {
  activeSchematics,
  characters,
  professionPriorities,
  resourceObservations,
  resourcePlanets,
  resourceTypes,
  resources,
  schematicDependencies,
  schematicPropertyGroups,
  schematicPropertyWeights,
  schematicSlots,
  schematics,
  settings,
  snapshots,
  verdicts,
} from "../db/schema";
import { runIngest } from "../ingest/pipeline";
import type {
  ActiveSchematicEntry,
  Character,
  CreateCharacterInput,
  ProfessionPriority,
  RefreshResult,
  Resource,
  ResourceTypeRef,
  SchematicDetail,
  SchematicListFilter,
  SchematicSummary,
  SnapshotSummary,
  VerdictEntry,
} from "../shared/ipc-types";
import { professionForSkillGroup } from "../shared/professions";
import { recomputeVerdicts } from "./verdict/recompute";

interface GalaxyConfig {
  key: string;
  id: number;
  name: string;
  active: boolean;
}

const galaxiesByKey: Record<string, GalaxyConfig> = Object.fromEntries(
  (galaxiesConfig.galaxies as GalaxyConfig[]).map((g) => [g.key, g]),
);

function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
  const db = getDb();
  const existing = db.select().from(settings).where(eq(settings.key, key)).get();
  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.key, key)).run();
  } else {
    db.insert(settings).values({ key, value }).run();
  }
}

/**
 * Broadcast a verdicts-updated event so renderer routes that display
 * verdict-derived UI (Resources, dashboard) can refetch. Channel is
 * non-throwing: if no renderer windows exist (e.g. quitting), it's a no-op.
 */
function emitVerdictsUpdated(characterId: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("verdicts:updated", { characterId });
  }
}

/**
 * Recompute verdicts for every character whose galaxy matches the given
 * galaxy ID, then fire the updated event for each. Used after snapshot
 * refresh. For Phase 3 with one character, this is one call; the loop is
 * a Phase 9 (multi-character) carry-forward.
 */
function recomputeForGalaxy(galaxyId: number): void {
  const db = getDb();
  const chars = db.select().from(characters).where(eq(characters.galaxyId, galaxyId)).all();
  for (const c of chars) {
    try {
      const result = recomputeVerdicts(c.id);
      console.log(
        `[verdict] ${c.name} (galaxy ${galaxyId}): ${result.chase} CHASE / ${result.maybe} MAYBE / ${result.resourcesScored} scored in ${result.durationMs}ms`,
      );
      emitVerdictsUpdated(c.id);
    } catch (e) {
      console.error(`[verdict] recompute failed for character ${c.id}:`, e);
    }
  }
}

/**
 * Recompute verdicts for one character (after they mutate their active
 * schematic list or are created).
 */
function recomputeForCharacter(characterId: string): void {
  try {
    const result = recomputeVerdicts(characterId);
    console.log(
      `[verdict] character ${characterId}: ${result.chase} CHASE / ${result.maybe} MAYBE / ${result.resourcesScored} scored in ${result.durationMs}ms`,
    );
    emitVerdictsUpdated(characterId);
  } catch (e) {
    console.error(`[verdict] recompute failed for character ${characterId}:`, e);
  }
}

export function registerIpc(): void {
  // === Phase 1: snapshots + resources ===

  ipcMain.handle("snapshot:refresh", async (_evt, galaxyKey?: string): Promise<RefreshResult> => {
    const key = galaxyKey ?? galaxiesConfig.default;
    const galaxy = galaxiesByKey[key];
    if (!galaxy) throw new Error(`Unknown galaxy key: ${key}`);
    const result = await runIngest(galaxy.id);
    // Implicit verdict recompute: the new snapshot has fresh stat data
    // and may include new spawns; verdicts depend on both.
    recomputeForGalaxy(galaxy.id);
    return result;
  });

  ipcMain.handle("snapshot:latest", async (): Promise<SnapshotSummary | null> => {
    const db = getDb();
    const row = db.select().from(snapshots).orderBy(desc(snapshots.fetchedAt)).limit(1).get();
    return row
      ? {
          id: row.id,
          galaxyId: row.galaxyId,
          fetchedAt: row.fetchedAt,
          resourceCount: row.resourceCount,
        }
      : null;
  });

  ipcMain.handle("resources:list", async (_evt, snapshotId?: string): Promise<Resource[]> => {
    const db = getDb();
    const targetId =
      snapshotId ??
      db.select().from(snapshots).orderBy(desc(snapshots.fetchedAt)).limit(1).get()?.id;
    if (!targetId) return [];

    const observations = db
      .select()
      .from(resourceObservations)
      .where(eq(resourceObservations.snapshotId, targetId))
      .all();
    const resourceIds = observations.map((o) => o.resourceId);
    if (resourceIds.length === 0) return [];

    const rows = db.select().from(resources).where(inArray(resources.id, resourceIds)).all();

    const planetRows = db
      .select()
      .from(resourcePlanets)
      .where(inArray(resourcePlanets.resourceId, resourceIds))
      .all();
    const planetMap = new Map<string, string[]>();
    for (const p of planetRows) {
      const arr = planetMap.get(p.resourceId) ?? [];
      arr.push(p.planet);
      planetMap.set(p.resourceId, arr);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      typeId: r.typeId,
      typeDisplayName: r.typeDisplayName,
      groupId: r.groupId,
      enteredBy: r.enteredBy ?? "",
      addedDate: r.addedDate,
      galaxyId: r.galaxyId,
      stats: {
        OQ: r.oq,
        CR: r.cr,
        CD: r.cd,
        DR: r.dr,
        FL: r.fl,
        HR: r.hr,
        MA: r.ma,
        PE: r.pe,
        SR: r.sr,
        UT: r.ut,
        ER: r.er,
      },
      planets: planetMap.get(r.id) ?? [],
    }));
  });

  // === Phase 2: characters ===

  ipcMain.handle("characters:list", async (): Promise<Character[]> => {
    const db = getDb();
    return db.select().from(characters).all();
  });

  ipcMain.handle("characters:active", async (): Promise<Character | null> => {
    const db = getDb();
    const activeId = getSetting("active.character");
    if (!activeId) {
      // No active character set — auto-pick deterministically by oldest first.
      // (SQLite's no-ORDER-BY result order is undefined; without this the
      // chosen character could shift between launches when there's >1 char.)
      const first = db.select().from(characters).orderBy(characters.createdAt).limit(1).get();
      if (first) {
        setSetting("active.character", first.id);
        return first;
      }
      return null;
    }
    return db.select().from(characters).where(eq(characters.id, activeId)).get() ?? null;
  });

  ipcMain.handle(
    "characters:create",
    async (_evt, input: CreateCharacterInput): Promise<Character> => {
      const db = getDb();
      const id = randomUUID();
      const now = Date.now();
      const char: Character = {
        id,
        name: input.name,
        galaxyId: input.galaxyId,
        createdAt: now,
      };
      db.transaction((tx) => {
        tx.insert(characters).values(char).run();
        for (const p of input.priorities) {
          tx.insert(professionPriorities)
            .values({
              characterId: id,
              profession: p.profession,
              tier: p.tier,
              rank: p.rank,
            })
            .run();
        }
      });
      setSetting("active.character", id);
      // New character has no active schematics yet — recompute writes zero
      // verdicts but clears any stale rows defensively.
      recomputeForCharacter(id);
      return char;
    },
  );

  ipcMain.handle("characters:setActive", async (_evt, id: string): Promise<void> => {
    const db = getDb();
    const exists = db.select().from(characters).where(eq(characters.id, id)).get();
    if (!exists) throw new Error(`Character not found: ${id}`);
    setSetting("active.character", id);
  });

  ipcMain.handle(
    "characters:priorities",
    async (_evt, characterId: string): Promise<ProfessionPriority[]> => {
      const db = getDb();
      return db
        .select()
        .from(professionPriorities)
        .where(eq(professionPriorities.characterId, characterId))
        .all()
        .map((p) => ({
          profession: p.profession,
          tier: p.tier as ProfessionPriority["tier"],
          rank: p.rank,
        }));
    },
  );

  // === Phase 2: schematics ===

  ipcMain.handle(
    "schematics:list",
    async (_evt, filter?: SchematicListFilter): Promise<SchematicSummary[]> => {
      const db = getDb();
      const activeCharacterId = getSetting("active.character");
      let activeSet = new Set<string>();
      if (activeCharacterId) {
        const activeRows = db
          .select()
          .from(activeSchematics)
          .where(eq(activeSchematics.characterId, activeCharacterId))
          .all();
        activeSet = new Set(activeRows.map((r) => r.schematicId));
      }

      const conditions = [];
      if (filter?.query) {
        const q = `%${filter.query}%`;
        conditions.push(or(like(schematics.name, q), like(schematics.id, q)));
      }
      if (filter?.objectType !== undefined) {
        conditions.push(eq(schematics.objectType, filter.objectType));
      }

      const baseQuery = db.select().from(schematics);
      const rows =
        conditions.length > 0 ? baseQuery.where(and(...conditions)).all() : baseQuery.all();

      let mapped = rows.map(
        (r): SchematicSummary => ({
          id: r.id,
          name: r.name,
          objectType: r.objectType,
          skillGroup: r.skillGroup,
          craftingTab: r.craftingTab,
          complexity: r.complexity ?? 0,
          profession: professionForSkillGroup(r.skillGroup),
          isActive: activeSet.has(r.id),
        }),
      );

      if (filter?.profession) {
        mapped = mapped.filter((s) => s.profession === filter.profession);
      }
      if (filter?.onlyActive) {
        mapped = mapped.filter((s) => s.isActive);
      }

      // Stable sort: by name asc
      mapped.sort((a, b) => a.name.localeCompare(b.name));
      return mapped;
    },
  );

  ipcMain.handle("schematics:detail", async (_evt, id: string): Promise<SchematicDetail | null> => {
    const db = getDb();
    const s = db.select().from(schematics).where(eq(schematics.id, id)).get();
    if (!s) return null;

    const slotsRows = db
      .select()
      .from(schematicSlots)
      .where(eq(schematicSlots.schematicId, id))
      .all();

    const groupRows = db
      .select()
      .from(schematicPropertyGroups)
      .where(eq(schematicPropertyGroups.schematicId, id))
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
    const weightsByGroup = new Map<number, Array<{ stat: string; weight: number }>>();
    for (const w of weightRows) {
      const arr = weightsByGroup.get(w.groupId) ?? [];
      arr.push({ stat: w.stat, weight: w.weight });
      weightsByGroup.set(w.groupId, arr);
    }

    const depRows = db
      .select()
      .from(schematicDependencies)
      .where(eq(schematicDependencies.parentSchematicId, id))
      .all();
    const childIds = depRows.map((d) => d.childSchematicId);
    const childNamesById = new Map<string, string>();
    if (childIds.length > 0) {
      const children = db.select().from(schematics).where(inArray(schematics.id, childIds)).all();
      for (const c of children) childNamesById.set(c.id, c.name);
    }

    const activeCharId = getSetting("active.character");
    const isActive = activeCharId
      ? db
          .select()
          .from(activeSchematics)
          .where(
            and(
              eq(activeSchematics.characterId, activeCharId),
              eq(activeSchematics.schematicId, id),
            ),
          )
          .get() !== undefined
      : false;

    return {
      id: s.id,
      name: s.name,
      objectType: s.objectType,
      skillGroup: s.skillGroup,
      craftingTab: s.craftingTab,
      craftingTabBitmask: s.craftingTabBitmask ?? 0,
      complexity: s.complexity ?? 0,
      objectSize: s.objectSize ?? 0,
      xpType: s.xpType,
      xpAmount: s.xpAmount ?? 0,
      objectPath: s.objectPath ?? "",
      parentObjectPath: s.parentObjectPath ?? "",
      profession: professionForSkillGroup(s.skillGroup),
      slots: slotsRows.map((sl) => ({
        slotName: sl.slotName,
        ingredientType: sl.ingredientType,
        ingredientObject: sl.ingredientObject,
        unitsRequired: sl.unitsRequired,
        contribution: sl.contribution ?? 100,
      })),
      propertyGroups: groupRows.map((g) => ({
        id: g.id,
        propertyName: g.propertyName,
        expGroup: g.expGroup,
        weightTotal: g.weightTotal,
        weights: weightsByGroup.get(g.id) ?? [],
      })),
      dependencies: depRows.map((d) => ({
        slotName: d.slotName,
        childSchematicId: d.childSchematicId,
        childName: childNamesById.get(d.childSchematicId) ?? d.childSchematicId,
      })),
      isActive,
    };
  });

  ipcMain.handle(
    "schematics:listActive",
    async (_evt, characterId: string): Promise<ActiveSchematicEntry[]> => {
      const db = getDb();
      const rows = db
        .select()
        .from(activeSchematics)
        .where(eq(activeSchematics.characterId, characterId))
        .all();
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.schematicId);
      const schemRows = db.select().from(schematics).where(inArray(schematics.id, ids)).all();
      const byId = new Map(schemRows.map((s) => [s.id, s]));
      const parentIds = rows.map((r) => r.parentSchematicId).filter((p): p is string => !!p);
      const parentRows =
        parentIds.length > 0
          ? db.select().from(schematics).where(inArray(schematics.id, parentIds)).all()
          : [];
      const parentNameById = new Map(parentRows.map((p) => [p.id, p.name]));

      return rows
        .map((r): ActiveSchematicEntry => {
          const s = byId.get(r.schematicId);
          return {
            schematicId: r.schematicId,
            schematicName: s?.name ?? r.schematicId,
            source: r.source as ActiveSchematicEntry["source"],
            parentSchematicId: r.parentSchematicId,
            parentSchematicName: r.parentSchematicId
              ? (parentNameById.get(r.parentSchematicId) ?? null)
              : null,
            addedAt: r.addedAt,
            profession: professionForSkillGroup(s?.skillGroup),
            craftingTab: s?.craftingTab ?? null,
          };
        })
        .sort((a, b) => a.schematicName.localeCompare(b.schematicName));
    },
  );

  ipcMain.handle(
    "schematics:addActive",
    async (
      _evt,
      characterId: string,
      schematicId: string,
      withSubcomponents: boolean,
    ): Promise<{ added: string[]; skipped: string[] }> => {
      const db = getDb();
      const target = db.select().from(schematics).where(eq(schematics.id, schematicId)).get();
      if (!target) throw new Error(`Schematic not found: ${schematicId}`);

      const existing = db
        .select()
        .from(activeSchematics)
        .where(eq(activeSchematics.characterId, characterId))
        .all();
      const existingSet = new Set(existing.map((e) => e.schematicId));

      const added: string[] = [];
      const skipped: string[] = [];
      const now = Date.now();

      db.transaction((tx) => {
        if (!existingSet.has(schematicId)) {
          tx.insert(activeSchematics)
            .values({
              characterId,
              schematicId,
              source: "user",
              parentSchematicId: null,
              addedAt: now,
            })
            .run();
          added.push(schematicId);
          existingSet.add(schematicId);
        } else {
          skipped.push(schematicId);
        }

        if (withSubcomponents) {
          const deps = tx
            .select()
            .from(schematicDependencies)
            .where(eq(schematicDependencies.parentSchematicId, schematicId))
            .all();
          for (const d of deps) {
            if (!existingSet.has(d.childSchematicId)) {
              tx.insert(activeSchematics)
                .values({
                  characterId,
                  schematicId: d.childSchematicId,
                  source: "inherited",
                  parentSchematicId: schematicId,
                  addedAt: now,
                })
                .run();
              added.push(d.childSchematicId);
              existingSet.add(d.childSchematicId);
            } else {
              skipped.push(d.childSchematicId);
            }
          }
        }
      });

      // Active list changed → verdicts depend on it.
      if (added.length > 0) recomputeForCharacter(characterId);
      return { added, skipped };
    },
  );

  ipcMain.handle(
    "schematics:removeActive",
    async (_evt, characterId: string, schematicId: string): Promise<void> => {
      const db = getDb();
      const result = db
        .delete(activeSchematics)
        .where(
          and(
            eq(activeSchematics.characterId, characterId),
            eq(activeSchematics.schematicId, schematicId),
          ),
        )
        .run();
      if (result.changes > 0) recomputeForCharacter(characterId);
    },
  );

  // === Phase 2: resource types ===

  // === Phase 3: verdicts ===

  ipcMain.handle("verdicts:list", async (_evt, characterId: string): Promise<VerdictEntry[]> => {
    const db = getDb();
    // Latest snapshot for this character's galaxy.
    const char = db.select().from(characters).where(eq(characters.id, characterId)).get();
    if (!char) return [];
    const latest = db
      .select()
      .from(snapshots)
      .where(eq(snapshots.galaxyId, char.galaxyId))
      .orderBy(desc(snapshots.fetchedAt))
      .limit(1)
      .get();
    if (!latest) return [];
    const rows = db
      .select()
      .from(verdicts)
      .where(and(eq(verdicts.characterId, characterId), eq(verdicts.snapshotId, latest.id)))
      .all();
    return rows.map((r) => ({
      resourceId: r.resourceId,
      tier: r.tier as VerdictEntry["tier"],
      reason: r.reason ?? "",
      topScore: r.topScore,
      matchedSchematicCount: r.matchedSchematicCount,
    }));
  });

  ipcMain.handle("resourceTypes:get", async (_evt, id: string): Promise<ResourceTypeRef | null> => {
    const db = getDb();
    const row = db.select().from(resourceTypes).where(eq(resourceTypes.id, id)).get();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      groupId: row.groupId,
      parentGroup: row.parentGroup ?? "",
      caps: {
        OQ: row.capOq,
        CR: row.capCr,
        CD: row.capCd,
        DR: row.capDr,
        FL: row.capFl,
        HR: row.capHr,
        MA: row.capMa,
        PE: row.capPe,
        SR: row.capSr,
        UT: row.capUt,
        ER: row.capEr,
      },
      floors: {
        OQ: row.floorOq,
        CR: row.floorCr,
        CD: row.floorCd,
        DR: row.floorDr,
        FL: row.floorFl,
        HR: row.floorHr,
        MA: row.floorMa,
        PE: row.floorPe,
        SR: row.floorSr,
        UT: row.floorUt,
        ER: row.floorEr,
      },
    };
  });
}
