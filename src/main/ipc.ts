import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { BrowserWindow, ipcMain } from "electron";
import galaxiesConfig from "../../reference-data/galaxies.json";
import { getDb } from "../db";
import {
  activeSchematics,
  characters,
  inventoryEntries,
  professionPriorities,
  resourceGroups,
  resourceObservations,
  resourcePlanets,
  resourceTypeGroups,
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
import { lookupResourceByName } from "../ingest/gh-lookup";
import { runIngest } from "../ingest/pipeline";
import type {
  ActiveSchematicEntry,
  Character,
  CreateCharacterInput,
  FinderRankInput,
  FinderResult,
  FinderResultRow,
  GhLookupInput,
  GhLookupResponse,
  InventoryEntry,
  InventoryStatus,
  InventoryUpsertInput,
  ProfessionPriority,
  RefreshResult,
  Resource,
  ResourceDetail,
  ResourceTypeRef,
  ScoredMatchView,
  SchematicDetail,
  SchematicListFilter,
  SchematicSummary,
  SnapshotSummary,
  VerdictEntry,
  VerdictTier,
} from "../shared/ipc-types";
import { professionForSkillGroup } from "../shared/professions";
import { buildTypeAncestorMap, resourceTypeFitsRawSlot } from "../core/verdict/compat";
import { scoreGroup } from "../core/verdict/score";
import type { ResourceStats, StatWeight } from "../core/verdict/types";
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
function formatInvSuffix(inventoryEntries: number, inventorySeededMatches: number): string {
  return inventoryEntries > 0
    ? ` · inventory ${inventoryEntries} entr${inventoryEntries === 1 ? "y" : "ies"}, ${inventorySeededMatches} owned-seeded matches`
    : " · empty inventory (Phase 3 thresholds)";
}

function recomputeForGalaxy(galaxyId: number): void {
  const db = getDb();
  const chars = db.select().from(characters).where(eq(characters.galaxyId, galaxyId)).all();
  for (const c of chars) {
    try {
      const result = recomputeVerdicts(c.id);
      console.log(
        `[verdict] ${c.name} (galaxy ${galaxyId}): ${result.chase} CHASE / ${result.maybe} MAYBE / ${result.resourcesScored} scored${formatInvSuffix(result.inventoryEntries, result.inventorySeededMatches)} in ${result.durationMs}ms`,
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
      `[verdict] character ${characterId}: ${result.chase} CHASE / ${result.maybe} MAYBE / ${result.resourcesScored} scored${formatInvSuffix(result.inventoryEntries, result.inventorySeededMatches)} in ${result.durationMs}ms`,
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

    // Resolve display names for each slot's `ingredientObject`. Raw-resource
    // slots (type 0) reference a resource group or specific type ID; look
    // those up in the reference data so the UI shows "Diatium Copper"
    // instead of "copper_diatium". Component slots (type 1/3) reference an
    // IFF path; map to the producing schematic's name when known, else
    // humanise the IFF basename as a fallback.
    const ingredientIds = Array.from(new Set(slotsRows.map((sl) => sl.ingredientObject)));
    const ingredientDisplayNames = new Map<string, string>();
    if (ingredientIds.length > 0) {
      // Raw-resource lookups (type 0): groups first, then types as fallback.
      const groupHits = db
        .select()
        .from(resourceGroups)
        .where(inArray(resourceGroups.id, ingredientIds))
        .all();
      for (const g of groupHits) ingredientDisplayNames.set(g.id, g.name);
      const remainingForType = ingredientIds.filter((i) => !ingredientDisplayNames.has(i));
      if (remainingForType.length > 0) {
        const typeHits = db
          .select()
          .from(resourceTypes)
          .where(inArray(resourceTypes.id, remainingForType))
          .all();
        for (const t of typeHits) ingredientDisplayNames.set(t.id, t.name);
      }
      // Component lookups (type 1/3): the ingredient is an IFF path. The
      // producing schematic's `objectPath` matches exactly; pull names.
      const remainingForComponent = ingredientIds.filter(
        (i) => !ingredientDisplayNames.has(i) && i.includes("/"),
      );
      if (remainingForComponent.length > 0) {
        const componentHits = db
          .select()
          .from(schematics)
          .where(inArray(schematics.objectPath, remainingForComponent))
          .all();
        for (const c of componentHits) {
          if (c.objectPath) ingredientDisplayNames.set(c.objectPath, c.name);
        }
      }
    }

    function humaniseIff(path: string): string {
      // Fallback for component IFFs not matched to a schematic. Take the
      // basename, strip .iff, convert underscores to spaces, title-case.
      const base = path.split("/").pop()?.replace(/\.iff$/i, "") ?? path;
      return base
        .split("_")
        .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
        .join(" ");
    }

    function resolveDisplayName(ingredientObject: string, ingredientType: number): string {
      const hit = ingredientDisplayNames.get(ingredientObject);
      if (hit) return hit;
      if (ingredientType === 0) {
        // Raw resource without a hit: leave the canonical id as-is — the
        // renderer caption still shows it. Reference data may be older
        // than the schematic's referenced group/type.
        return ingredientObject;
      }
      // Component path with no schematic match: humanise IFF basename.
      return humaniseIff(ingredientObject);
    }

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
        ingredientDisplayName: resolveDisplayName(sl.ingredientObject, sl.ingredientType),
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

  ipcMain.handle(
    "resources:detail",
    async (_evt, resourceId: string): Promise<ResourceDetail | null> => {
      const db = getDb();
      const r = db.select().from(resources).where(eq(resources.id, resourceId)).get();
      if (!r) return null;

      const tr = db.select().from(resourceTypes).where(eq(resourceTypes.id, r.typeId)).get();
      const group = tr
        ? db.select().from(resourceGroups).where(eq(resourceGroups.id, tr.groupId)).get()
        : null;
      const planetRows = db
        .select()
        .from(resourcePlanets)
        .where(eq(resourcePlanets.resourceId, r.id))
        .all();

      // Latest verdict for the active character on the current snapshot of
      // this resource's galaxy. Falls back to null if no character/snapshot/
      // verdict — UI just hides the section.
      let verdictView: ResourceDetail["verdict"] = null;
      const activeCharId = getSetting("active.character");
      if (activeCharId) {
        const latest = db
          .select()
          .from(snapshots)
          .where(eq(snapshots.galaxyId, r.galaxyId))
          .orderBy(desc(snapshots.fetchedAt))
          .limit(1)
          .get();
        if (latest) {
          const v = db
            .select()
            .from(verdicts)
            .where(
              and(
                eq(verdicts.resourceId, r.id),
                eq(verdicts.characterId, activeCharId),
                eq(verdicts.snapshotId, latest.id),
              ),
            )
            .get();
          if (v) {
            // breakdown_json is persisted as the JSON-serialised ScoredMatch
            // array (already sorted highest-score-first by rollup.ts).
            let breakdown: ScoredMatchView[] = [];
            if (v.breakdownJson) {
              try {
                breakdown = JSON.parse(v.breakdownJson) as ScoredMatchView[];
              } catch (e) {
                console.warn(`[resources:detail] failed to parse breakdown for ${r.id}:`, e);
              }
            }
            verdictView = {
              tier: v.tier as VerdictTier,
              reason: v.reason ?? "",
              topScore: v.topScore,
              matchedSchematicCount: v.matchedSchematicCount,
              breakdown,
            };
          }
        }
      }

      // "Fits these active schematics" — pull the active list, then for each
      // active schematic walk its raw slots and check if this resource's
      // type can fill any of them. Independent of whether the verdict broke
      // threshold (a SKIP resource might still legitimately fill a slot —
      // useful orientation).
      const fitsActiveSchematics: ResourceDetail["fitsActiveSchematics"] = [];
      if (activeCharId) {
        const activeRows = db
          .select()
          .from(activeSchematics)
          .where(eq(activeSchematics.characterId, activeCharId))
          .all();
        if (activeRows.length > 0) {
          const ids = activeRows.map((a) => a.schematicId);
          const schemRows = db
            .select()
            .from(schematics)
            .where(inArray(schematics.id, ids))
            .all();
          const schemById = new Map(schemRows.map((s) => [s.id, s]));
          // Raw slots only (ingredientType 0).
          const slotRows = db
            .select()
            .from(schematicSlots)
            .where(
              and(
                inArray(schematicSlots.schematicId, ids),
                eq(schematicSlots.ingredientType, 0),
              ),
            )
            .all();
          // Type-ancestor edges for this one type — enough to resolve all
          // raw-slot ingredient identifiers.
          const tgEdges = db
            .select()
            .from(resourceTypeGroups)
            .where(eq(resourceTypeGroups.typeId, r.typeId))
            .all();
          const typeAncestors = buildTypeAncestorMap(tgEdges);

          const slotsBySchematic = new Map<
            string,
            Array<{ slotName: string; ingredientObject: string }>
          >();
          for (const s of slotRows) {
            const arr = slotsBySchematic.get(s.schematicId) ?? [];
            arr.push({ slotName: s.slotName, ingredientObject: s.ingredientObject });
            slotsBySchematic.set(s.schematicId, arr);
          }

          for (const a of activeRows) {
            const s = schemById.get(a.schematicId);
            if (!s) continue;
            const candidateSlots = slotsBySchematic.get(a.schematicId) ?? [];
            const matchingSlots = candidateSlots
              .filter((cs) =>
                resourceTypeFitsRawSlot(r.typeId, cs.ingredientObject, typeAncestors),
              )
              .map((cs) => cs.slotName);
            if (matchingSlots.length === 0) continue;
            fitsActiveSchematics.push({
              schematicId: a.schematicId,
              schematicName: s.name,
              profession: professionForSkillGroup(s.skillGroup),
              inheritedFromParent: a.source === "inherited",
              matchingSlots,
            });
          }
          fitsActiveSchematics.sort((a, b) => a.schematicName.localeCompare(b.schematicName));
        }
      }

      // Inventory entry for this resource on the active character, if any.
      let inventory: InventoryEntry | null = null;
      if (activeCharId) {
        const invRow = db
          .select()
          .from(inventoryEntries)
          .where(
            and(
              eq(inventoryEntries.characterId, activeCharId),
              eq(inventoryEntries.resourceId, r.id),
            ),
          )
          .get();
        if (invRow) {
          inventory = {
            characterId: invRow.characterId,
            resourceId: invRow.resourceId,
            resourceName: r.name,
            typeDisplayName: r.typeDisplayName,
            units: invRow.units,
            status: invRow.status as InventoryStatus,
            notes: invRow.notes,
            addedAt: invRow.addedAt,
            updatedAt: invRow.updatedAt,
          };
        }
      }

      return {
        id: r.id,
        name: r.name,
        typeId: r.typeId,
        typeDisplayName: r.typeDisplayName,
        groupId: r.groupId,
        groupName: group?.name ?? null,
        enteredBy: r.enteredBy ?? "",
        addedDate: r.addedDate,
        galaxyId: r.galaxyId,
        planets: planetRows.map((p) => p.planet),
        stats: {
          OQ: r.oq, CR: r.cr, CD: r.cd, DR: r.dr,
          FL: r.fl, HR: r.hr, MA: r.ma, PE: r.pe,
          SR: r.sr, UT: r.ut, ER: r.er,
        },
        caps: tr
          ? {
              OQ: tr.capOq, CR: tr.capCr, CD: tr.capCd, DR: tr.capDr,
              FL: tr.capFl, HR: tr.capHr, MA: tr.capMa, PE: tr.capPe,
              SR: tr.capSr, UT: tr.capUt, ER: tr.capEr,
            }
          : { OQ: 0, CR: 0, CD: 0, DR: 0, FL: 0, HR: 0, MA: 0, PE: 0, SR: 0, UT: 0, ER: 0 },
        floors: tr
          ? {
              OQ: tr.floorOq, CR: tr.floorCr, CD: tr.floorCd, DR: tr.floorDr,
              FL: tr.floorFl, HR: tr.floorHr, MA: tr.floorMa, PE: tr.floorPe,
              SR: tr.floorSr, UT: tr.floorUt, ER: tr.floorEr,
            }
          : { OQ: 0, CR: 0, CD: 0, DR: 0, FL: 0, HR: 0, MA: 0, PE: 0, SR: 0, UT: 0, ER: 0 },
        verdict: verdictView,
        fitsActiveSchematics,
        inventory,
      };
    },
  );

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

  // === Phase 4: inventory ===

  // Helper: join inventory rows with their resource for display fields.
  // Skips orphan rows (resource was deleted) defensively — they shouldn't
  // exist normally but a future inventory-import flow could create them.
  function hydrateInventoryRows(
    rows: Array<typeof inventoryEntries.$inferSelect>,
  ): InventoryEntry[] {
    if (rows.length === 0) return [];
    const db = getDb();
    const resourceIds = rows.map((r) => r.resourceId);
    const resourceRows = db
      .select()
      .from(resources)
      .where(inArray(resources.id, resourceIds))
      .all();
    const byId = new Map(resourceRows.map((r) => [r.id, r]));
    const out: InventoryEntry[] = [];
    for (const inv of rows) {
      const r = byId.get(inv.resourceId);
      if (!r) continue;
      out.push({
        characterId: inv.characterId,
        resourceId: inv.resourceId,
        resourceName: r.name,
        typeDisplayName: r.typeDisplayName,
        units: inv.units,
        status: inv.status as InventoryStatus,
        notes: inv.notes,
        addedAt: inv.addedAt,
        updatedAt: inv.updatedAt,
      });
    }
    return out;
  }

  ipcMain.handle(
    "inventory:list",
    async (_evt, characterId: string): Promise<InventoryEntry[]> => {
      const db = getDb();
      const rows = db
        .select()
        .from(inventoryEntries)
        .where(eq(inventoryEntries.characterId, characterId))
        .all();
      return hydrateInventoryRows(rows).sort((a, b) =>
        a.resourceName.localeCompare(b.resourceName),
      );
    },
  );

  ipcMain.handle(
    "inventory:upsert",
    async (_evt, input: InventoryUpsertInput): Promise<InventoryEntry> => {
      if (input.units < 0) throw new Error("units cannot be negative");
      if (!["live", "despawned", "reserved"].includes(input.status)) {
        throw new Error(`invalid status: ${input.status}`);
      }
      const db = getDb();
      // Validate the FKs explicitly — better-sqlite3 doesn't enforce them
      // by default and a silent insert against a missing character/resource
      // would surface as a confusing UI bug later.
      const char = db
        .select()
        .from(characters)
        .where(eq(characters.id, input.characterId))
        .get();
      if (!char) throw new Error(`character not found: ${input.characterId}`);
      const res = db.select().from(resources).where(eq(resources.id, input.resourceId)).get();
      if (!res) throw new Error(`resource not found: ${input.resourceId}`);

      const now = Date.now();
      const existing = db
        .select()
        .from(inventoryEntries)
        .where(
          and(
            eq(inventoryEntries.characterId, input.characterId),
            eq(inventoryEntries.resourceId, input.resourceId),
          ),
        )
        .get();
      if (existing) {
        db.update(inventoryEntries)
          .set({
            units: input.units,
            status: input.status,
            notes: input.notes ?? null,
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryEntries.characterId, input.characterId),
              eq(inventoryEntries.resourceId, input.resourceId),
            ),
          )
          .run();
      } else {
        db.insert(inventoryEntries)
          .values({
            characterId: input.characterId,
            resourceId: input.resourceId,
            units: input.units,
            status: input.status,
            notes: input.notes ?? null,
            addedAt: now,
            updatedAt: now,
          })
          .run();
      }
      // Phase 4 Stage C: inventory mutations move the verdict math.
      // Recompute fires after the row is committed so the new
      // ownedBestScore lookup sees the latest state.
      recomputeForCharacter(input.characterId);
      const hydrated = hydrateInventoryRows(
        db
          .select()
          .from(inventoryEntries)
          .where(
            and(
              eq(inventoryEntries.characterId, input.characterId),
              eq(inventoryEntries.resourceId, input.resourceId),
            ),
          )
          .all(),
      );
      if (hydrated.length === 0) {
        throw new Error("inventory:upsert: row vanished after write");
      }
      return hydrated[0];
    },
  );

  ipcMain.handle(
    "inventory:remove",
    async (_evt, characterId: string, resourceId: string): Promise<void> => {
      const db = getDb();
      const result = db
        .delete(inventoryEntries)
        .where(
          and(
            eq(inventoryEntries.characterId, characterId),
            eq(inventoryEntries.resourceId, resourceId),
          ),
        )
        .run();
      if (result.changes > 0) recomputeForCharacter(characterId);
    },
  );

  // === Phase 4E: GH single-resource lookup ===

  ipcMain.handle(
    "gh:lookupResource",
    async (_evt, input: GhLookupInput): Promise<GhLookupResponse> => {
      if (!input?.name || input.name.trim().length === 0) {
        throw new Error("gh:lookupResource: name required");
      }
      if (!Number.isFinite(input.galaxyId)) {
        throw new Error("gh:lookupResource: numeric galaxyId required");
      }

      const cleanName = input.name.trim();
      const db = getDb();

      // Short-circuit if we already have this resource locally — keeps GH
      // traffic low and lets local data (with whatever we've ingested) win
      // by default. Per advisor: local-first, GH is the fallback for
      // unknowns. Caller can still see existing data via resources:detail.
      const existing = db.select().from(resources).where(eq(resources.id, cleanName)).get();
      if (existing) {
        return {
          found: true,
          resource: {
            id: existing.id,
            name: existing.name,
            typeId: existing.typeId,
            typeDisplayName: existing.typeDisplayName,
            groupId: existing.groupId,
            enteredBy: existing.enteredBy ?? "",
            addedDate: existing.addedDate,
            galaxyId: existing.galaxyId,
            stats: {
              OQ: existing.oq, CR: existing.cr, CD: existing.cd, DR: existing.dr,
              FL: existing.fl, HR: existing.hr, MA: existing.ma, PE: existing.pe,
              SR: existing.sr, UT: existing.ut, ER: existing.er,
            },
            planets: db
              .select()
              .from(resourcePlanets)
              .where(eq(resourcePlanets.resourceId, cleanName))
              .all()
              .map((p) => p.planet),
          },
          unavailableAt: null,
          unavailableBy: null,
          alreadyLocal: true,
        };
      }

      // Hit GH. Network failures bubble up to the renderer for display.
      console.log(`[gh] looking up "${cleanName}" on galaxy ${input.galaxyId}`);
      const result = await lookupResourceByName(cleanName, input.galaxyId);
      if (!result.found || !result.resource) {
        console.log(`[gh] "${cleanName}" not found on GH`);
        return {
          found: false,
          resource: null,
          unavailableAt: null,
          unavailableBy: null,
          alreadyLocal: false,
        };
      }

      // Persist to local `resources` table. No `resource_observations` row
      // — it's not in our snapshot. The lifetime-union row exists so the
      // inventory entry can FK-reference it. firstSeenAt/lastSeenAt fall
      // back to addedDate from GH (when GH first saw the spawn) since we
      // don't have local snapshot context for this fetched resource.
      const r = result.resource;
      const seenTs = r.addedDate || Date.now();
      db.transaction((tx) => {
        tx.insert(resources)
          .values({
            id: r.id,
            name: r.name,
            typeId: r.typeId,
            typeDisplayName: r.typeDisplayName,
            groupId: r.groupId,
            enteredBy: r.enteredBy || null,
            addedDate: r.addedDate,
            galaxyId: r.galaxyId,
            oq: r.stats.OQ, cr: r.stats.CR, cd: r.stats.CD, dr: r.stats.DR,
            fl: r.stats.FL, hr: r.stats.HR, ma: r.stats.MA, pe: r.stats.PE,
            sr: r.stats.SR, ut: r.stats.UT, er: r.stats.ER,
            firstSeenAt: seenTs,
            lastSeenAt: seenTs,
          })
          .run();
        for (const planet of r.planets) {
          tx.insert(resourcePlanets).values({ resourceId: r.id, planet }).run();
        }
      });

      console.log(
        `[gh] persisted "${cleanName}" (${r.typeDisplayName})${result.unavailableAt !== null ? ` — DESPAWNED on ${new Date(result.unavailableAt).toISOString()}` : ""}`,
      );

      return {
        found: true,
        resource: r,
        unavailableAt: result.unavailableAt,
        unavailableBy: result.unavailableBy,
        alreadyLocal: false,
      };
    },
  );

  // === Phase 5: Resource Finder (schematic-driven reverse search) ===

  ipcMain.handle(
    "finder:rank",
    async (_evt, input: FinderRankInput): Promise<FinderResult | null> => {
      const db = getDb();
      const schem = db.select().from(schematics).where(eq(schematics.id, input.schematicId)).get();
      if (!schem) return null;

      // All scoreable property groups on this schematic — ones with at least
      // one weight row. Renderer uses this to populate the picker dropdown.
      const groupRows = db
        .select()
        .from(schematicPropertyGroups)
        .where(eq(schematicPropertyGroups.schematicId, input.schematicId))
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

      const availableGroups = groupRows
        .map((g) => ({
          id: g.id,
          propertyName: g.propertyName,
          expGroup: g.expGroup,
          weights: weightsByGroup.get(g.id) ?? [],
        }))
        .filter((g) => g.weights.length > 0);

      if (availableGroups.length === 0) {
        // Schematic has no scoreable property groups — return the empty
        // structure so the renderer can show "nothing to rank against."
        return {
          schematic: {
            id: schem.id,
            name: schem.name,
            profession: professionForSkillGroup(schem.skillGroup),
          },
          availableGroups: [],
          selectedGroup: { id: 0, propertyName: null, expGroup: null, weights: [] },
          slotFilter: input.slotFilter ?? true,
          rows: [],
        };
      }

      // Pick the requested group, or default to the first scoreable one.
      const selectedGroup =
        availableGroups.find((g) => g.id === input.propertyGroupId) ?? availableGroups[0];

      // Slot list — only raw-resource slots (ingredientType=0). Used both
      // for the compat filter and to record which slots each row fits.
      const slotRows = db
        .select()
        .from(schematicSlots)
        .where(
          and(
            eq(schematicSlots.schematicId, input.schematicId),
            eq(schematicSlots.ingredientType, 0),
          ),
        )
        .all();
      const slotFilter = input.slotFilter ?? true;

      // Load current snapshot's resources for this schematic's galaxy. We
      // infer galaxy from the active character; if none, return empty.
      const activeCharId = getSetting("active.character");
      if (!activeCharId) {
        return {
          schematic: {
            id: schem.id,
            name: schem.name,
            profession: professionForSkillGroup(schem.skillGroup),
          },
          availableGroups,
          selectedGroup,
          slotFilter,
          rows: [],
        };
      }
      const activeChar = db
        .select()
        .from(characters)
        .where(eq(characters.id, activeCharId))
        .get();
      if (!activeChar) {
        return {
          schematic: {
            id: schem.id,
            name: schem.name,
            profession: professionForSkillGroup(schem.skillGroup),
          },
          availableGroups,
          selectedGroup,
          slotFilter,
          rows: [],
        };
      }
      const latest = db
        .select()
        .from(snapshots)
        .where(eq(snapshots.galaxyId, activeChar.galaxyId))
        .orderBy(desc(snapshots.fetchedAt))
        .limit(1)
        .get();
      if (!latest) {
        return {
          schematic: {
            id: schem.id,
            name: schem.name,
            profession: professionForSkillGroup(schem.skillGroup),
          },
          availableGroups,
          selectedGroup,
          slotFilter,
          rows: [],
        };
      }

      const obsRows = db
        .select()
        .from(resourceObservations)
        .where(eq(resourceObservations.snapshotId, latest.id))
        .all();
      const snapshotResourceIds = obsRows.map((r) => r.resourceId);
      if (snapshotResourceIds.length === 0) {
        return {
          schematic: {
            id: schem.id,
            name: schem.name,
            profession: professionForSkillGroup(schem.skillGroup),
          },
          availableGroups,
          selectedGroup,
          slotFilter,
          rows: [],
        };
      }

      const resourceRows = db
        .select()
        .from(resources)
        .where(inArray(resources.id, snapshotResourceIds))
        .all();

      // Type bounds + ancestor edges (only for types actually present).
      const typeIds = Array.from(new Set(resourceRows.map((r) => r.typeId)));
      const typeRowsAll = db
        .select()
        .from(resourceTypes)
        .where(inArray(resourceTypes.id, typeIds))
        .all();
      const typeById = new Map(typeRowsAll.map((t) => [t.id, t]));
      const tgEdges = db
        .select()
        .from(resourceTypeGroups)
        .where(inArray(resourceTypeGroups.typeId, typeIds))
        .all();
      const typeAncestors = buildTypeAncestorMap(tgEdges);

      // Inventory join — for the OWNED flag and to compute scoreOwned
      // against this schematic+propertyGroup so the UI can show delta.
      const inventoryRows = db
        .select()
        .from(inventoryEntries)
        .where(eq(inventoryEntries.characterId, activeCharId))
        .all();
      const inventoryById = new Map(inventoryRows.map((i) => [i.resourceId, i]));

      // Compute scoreOwned for the selected (schematic, propertyGroup) by
      // walking owned resources through the same compat + scoring path.
      let scoreOwned = 0;
      if (inventoryRows.length > 0) {
        const ownedIds = inventoryRows.map((i) => i.resourceId);
        const ownedRows = db
          .select()
          .from(resources)
          .where(inArray(resources.id, ownedIds))
          .all();
        for (const owned of ownedRows) {
          const tr = typeById.get(owned.typeId);
          if (!tr) continue;
          const fits = slotRows.some((s) =>
            resourceTypeFitsRawSlot(owned.typeId, s.ingredientObject, typeAncestors),
          );
          if (!fits) continue;
          const stats: ResourceStats = {
            OQ: owned.oq, CR: owned.cr, CD: owned.cd, DR: owned.dr,
            FL: owned.fl, HR: owned.hr, MA: owned.ma, PE: owned.pe,
            SR: owned.sr, UT: owned.ut, ER: owned.er,
          };
          const s = scoreGroup(stats, selectedGroup.weights);
          if (s !== null && s > scoreOwned) scoreOwned = s;
        }
      }

      // Planet lookup for the visible rows. We don't yet know which rows
      // will pass the slot filter, so query upfront for the full set.
      const planetRows = db
        .select()
        .from(resourcePlanets)
        .where(inArray(resourcePlanets.resourceId, snapshotResourceIds))
        .all();
      const planetsById = new Map<string, string[]>();
      for (const p of planetRows) {
        const arr = planetsById.get(p.resourceId) ?? [];
        arr.push(p.planet);
        planetsById.set(p.resourceId, arr);
      }

      // Score every candidate. Optionally filter to slot-fitting only.
      const rows: FinderResultRow[] = [];
      for (const r of resourceRows) {
        const tr = typeById.get(r.typeId);
        if (!tr) continue;

        const matchingSlots = slotRows
          .filter((s) => resourceTypeFitsRawSlot(r.typeId, s.ingredientObject, typeAncestors))
          .map((s) => s.slotName);
        if (slotFilter && matchingSlots.length === 0) continue;

        const stats: ResourceStats = {
          OQ: r.oq, CR: r.cr, CD: r.cd, DR: r.dr,
          FL: r.fl, HR: r.hr, MA: r.ma, PE: r.pe,
          SR: r.sr, UT: r.ut, ER: r.er,
        };
        const score = scoreGroup(stats, selectedGroup.weights);
        if (score === null) continue;

        const inv = inventoryById.get(r.id);
        const weightedStats = selectedGroup.weights.map((w) => ({
          stat: w.stat,
          value: stats[w.stat as keyof ResourceStats],
        }));

        rows.push({
          resourceId: r.id,
          resourceName: r.name,
          typeId: r.typeId,
          typeDisplayName: r.typeDisplayName,
          groupId: r.groupId,
          planets: planetsById.get(r.id) ?? [],
          score,
          scoreOwned,
          weightedStats,
          owned: !!inv,
          ownedUnits: inv?.units ?? null,
          fitsSlots: matchingSlots,
        });
      }

      rows.sort((a, b) => b.score - a.score);

      return {
        schematic: {
          id: schem.id,
          name: schem.name,
          profession: professionForSkillGroup(schem.skillGroup),
        },
        availableGroups,
        selectedGroup,
        slotFilter,
        rows,
      };
    },
  );
}
