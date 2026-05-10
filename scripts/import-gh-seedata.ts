// Phase 2 reference-data importer.
//
// Downloads five TSV files from pwillworth/galaxyharvester's seedData/
// folder and emits two canonical JSON files into reference-data/:
//   - resource-types.json (per-type stat caps and floors)
//   - schematics.json     (schematics + slots + property groups + weights + dependency edges)
//
// Source: 2019 publish9-vintage GH seedData (see research-notes.md §9 for
// the data-source pivot decision). If the audited weights ever drift from
// current Core3 IFFs, a sibling `import-core3-iffs.ts` would emit the same
// JSON shape; downstream code is decoupled from source.
//
// Usage:
//   pnpm exec tsx scripts/import-gh-seedata.ts
// Or:
//   ./node_modules/.bin/tsx scripts/import-gh-seedata.ts
//
// Re-runs are idempotent: refetches and re-emits.

import { writeFile } from "node:fs/promises";
import path from "node:path";

const GH_RAW =
  "https://raw.githubusercontent.com/pwillworth/galaxyharvester/master/database/seedData";

const FILES = {
  tResourceType: "tResourceType.txt",
  tSchematic: "tSchematic.txt",
  tSchematicIngredients: "tSchematicIngredients.txt",
  tSchematicQualities: "tSchematicQualities.txt",
  tSchematicResWeights: "tSchematicResWeights.txt",
} as const;

// Stat order in tResourceType TSV (after the 6 metadata columns).
// Matches GH's CREATE TABLE column order.
const STATS_IN_RESOURCE_TYPE_ORDER = [
  "CR", "CD", "DR", "FL", "HR", "MA", "PE", "OQ", "SR", "UT", "ER",
] as const;

type Stat = (typeof STATS_IN_RESOURCE_TYPE_ORDER)[number];

interface ResourceType {
  id: string;
  name: string;
  groupId: string;
  parentGroup: string;
  caps: Record<Stat, number>;
  floors: Record<Stat, number>;
}

interface SchematicMaster {
  id: string;
  name: string;
  objectType: number;
  skillGroup: string | null;
  craftingTabBitmask: number;
  complexity: number;
  objectSize: number;
  xpType: string | null;
  xpAmount: number;
  craftingTab: string | null;
  objectPath: string;
  parentObjectPath: string;
}

interface SchematicSlot {
  schematicId: string;
  slotName: string;
  ingredientType: number; // 0=raw, 1=specific component, 3=base-class component
  ingredientObject: string;
  unitsRequired: number;
  contribution: number;
}

interface SchematicPropertyGroup {
  id: number;
  schematicId: string;
  propertyName: string | null;
  expGroup: string | null;
  weightTotal: number;
}

interface SchematicResWeight {
  groupId: number;
  stat: string;
  weight: number;
}

interface SchematicDependency {
  parentSchematicId: string;
  childSchematicId: string;
  slotName: string;
}

interface SchematicOut {
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
  slots: Omit<SchematicSlot, "schematicId">[];
  propertyGroups: Array<{
    id: number;
    propertyName: string | null;
    expGroup: string | null;
    weightTotal: number;
    weights: { stat: string; weight: number }[];
  }>;
}

async function fetchTsv(name: string): Promise<string[][]> {
  const url = `${GH_RAW}/${name}`;
  console.log(`  ↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const text = await res.text();
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t"));
}

function intOrNull(s: string | undefined): number {
  if (s === undefined || s === "" || s === "null" || s === "NULL") return 0;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function strOrNull(s: string | undefined): string | null {
  if (s === undefined || s === "" || s === "null" || s === "NULL") return null;
  return s;
}

function parseResourceTypes(rows: string[][]): ResourceType[] {
  const out: ResourceType[] = [];
  for (const r of rows) {
    if (r.length < 28) continue; // not a real row
    const caps: Record<string, number> = {};
    const floors: Record<string, number> = {};
    STATS_IN_RESOURCE_TYPE_ORDER.forEach((stat, i) => {
      // metadata columns 0..5, then stat pairs start at col 6
      // each stat = (min at 6 + 2i, max at 6 + 2i + 1)
      const min = intOrNull(r[6 + i * 2]);
      const max = intOrNull(r[6 + i * 2 + 1]);
      floors[stat] = min;
      caps[stat] = max;
    });
    out.push({
      id: r[0],
      name: r[1],
      parentGroup: r[2],
      groupId: r[3],
      caps: caps as Record<Stat, number>,
      floors: floors as Record<Stat, number>,
    });
  }
  return out;
}

function parseSchematics(rows: string[][]): SchematicMaster[] {
  const out: SchematicMaster[] = [];
  for (const r of rows) {
    if (r.length < 11) continue;
    out.push({
      id: r[0],
      name: r[1],
      objectType: intOrNull(r[2]),
      skillGroup: strOrNull(r[3]),
      craftingTabBitmask: intOrNull(r[4]),
      complexity: intOrNull(r[5]),
      objectSize: intOrNull(r[6]),
      xpType: strOrNull(r[7]),
      xpAmount: intOrNull(r[8]),
      craftingTab: r[9] ? strOrNull(r[9]) : null,
      objectPath: r[10] ?? "",
      parentObjectPath: r[11] ?? "",
    });
  }
  return out;
}

// Re-reading the tSchematic.txt sample: columns appear to be in the order
//   schematicID, schematicName, objectType, skillGroup, craftingTabBitmask,
//   complexity, objectSize, craftingTab, xpAmount, objectPath, parentObjectPath
// — which mostly matches the SQL CREATE TABLE but with craftingTab and
// xpType/Amount slightly different. Adjusting parser to TSV ordering observed.
function parseSchematicsObserved(rows: string[][]): SchematicMaster[] {
  // Observed order from sample: id name objectType skillGroup tabBitmask
  // complexity objectSize craftingTab xpAmount objectPath parentObjectPath
  // (xpType is omitted from seed; absent column).
  const out: SchematicMaster[] = [];
  for (const r of rows) {
    if (r.length < 10) continue;
    out.push({
      id: r[0],
      name: r[1],
      objectType: intOrNull(r[2]),
      skillGroup: strOrNull(r[3]),
      craftingTabBitmask: intOrNull(r[4]),
      complexity: intOrNull(r[5]),
      objectSize: intOrNull(r[6]),
      craftingTab: strOrNull(r[7]),
      xpType: null,
      xpAmount: intOrNull(r[8]),
      objectPath: r[9] ?? "",
      parentObjectPath: r[10] ?? "",
    });
  }
  return out;
}

function parseSlots(rows: string[][]): SchematicSlot[] {
  const out: SchematicSlot[] = [];
  for (const r of rows) {
    if (r.length < 6) continue;
    out.push({
      schematicId: r[0],
      slotName: r[1],
      ingredientType: intOrNull(r[2]),
      ingredientObject: r[3] ?? "",
      unitsRequired: intOrNull(r[4]),
      contribution: intOrNull(r[5]),
    });
  }
  return out;
}

function parsePropertyGroups(rows: string[][]): SchematicPropertyGroup[] {
  const out: SchematicPropertyGroup[] = [];
  for (const r of rows) {
    if (r.length < 5) continue;
    const id = intOrNull(r[0]);
    if (id === 0) continue;
    out.push({
      id,
      schematicId: r[1],
      propertyName: strOrNull(r[2]),
      expGroup: strOrNull(r[3]),
      weightTotal: intOrNull(r[4]),
    });
  }
  return out;
}

function parseWeights(rows: string[][]): SchematicResWeight[] {
  const out: SchematicResWeight[] = [];
  for (const r of rows) {
    if (r.length < 3) continue;
    out.push({
      groupId: intOrNull(r[0]),
      stat: r[1],
      weight: intOrNull(r[2]),
    });
  }
  return out;
}

/**
 * For every slot with ingredientType 1 (specific component), try to find the
 * schematic whose `objectPath` matches the slot's `ingredientObject`. If
 * found, record a dependency edge. For ingredientType 3 (base-class
 * component), search by `parentObjectPath` matching the slot's IFF — this
 * yields the N:M relationship (a Stock slot accepts any schematic that
 * extends `stock.iff`).
 */
function buildDependencies(
  schematics: SchematicMaster[],
  slots: SchematicSlot[],
): SchematicDependency[] {
  const byObjectPath = new Map<string, SchematicMaster>();
  const byParentPath = new Map<string, SchematicMaster[]>();
  for (const s of schematics) {
    if (s.objectPath) byObjectPath.set(s.objectPath, s);
    if (s.parentObjectPath) {
      const arr = byParentPath.get(s.parentObjectPath) ?? [];
      arr.push(s);
      byParentPath.set(s.parentObjectPath, arr);
    }
  }

  const deps: SchematicDependency[] = [];
  let type1Hits = 0;
  let type3Hits = 0;
  let type1Misses = 0;
  let type3Misses = 0;

  for (const slot of slots) {
    if (slot.ingredientType === 0) continue;
    const isComponent = slot.ingredientType === 1 || slot.ingredientType === 3;
    if (!isComponent) continue;

    if (slot.ingredientType === 1) {
      const child = byObjectPath.get(slot.ingredientObject);
      if (child) {
        deps.push({
          parentSchematicId: slot.schematicId,
          childSchematicId: child.id,
          slotName: slot.slotName,
        });
        type1Hits++;
      } else {
        type1Misses++;
      }
    } else {
      // type 3 — base-class slot; accepts any schematic with parentObjectPath = the IFF
      const children = byParentPath.get(slot.ingredientObject) ?? [];
      for (const c of children) {
        deps.push({
          parentSchematicId: slot.schematicId,
          childSchematicId: c.id,
          slotName: slot.slotName,
        });
      }
      if (children.length > 0) type3Hits++;
      else type3Misses++;
    }
  }

  console.log(
    `  dependency edges: ${deps.length} total; type-1 ${type1Hits} hits / ${type1Misses} misses; type-3 ${type3Hits} hits (${deps.filter(d => slots.find(s => s.schematicId === d.parentSchematicId && s.slotName === d.slotName)?.ingredientType === 3).length} edges from one-to-many) / ${type3Misses} misses`,
  );
  return deps;
}

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), "reference-data");
  console.log("=== fetching GH seedData ===");
  const [resRows, schemRows, ingRows, qualRows, wtRows] = await Promise.all([
    fetchTsv(FILES.tResourceType),
    fetchTsv(FILES.tSchematic),
    fetchTsv(FILES.tSchematicIngredients),
    fetchTsv(FILES.tSchematicQualities),
    fetchTsv(FILES.tSchematicResWeights),
  ]);

  console.log("\n=== parsing ===");
  const types = parseResourceTypes(resRows);
  console.log(`  ${types.length} resource types`);
  const schematics = parseSchematicsObserved(schemRows);
  console.log(`  ${schematics.length} schematics`);
  const slots = parseSlots(ingRows);
  console.log(`  ${slots.length} ingredient slots`);
  const groups = parsePropertyGroups(qualRows);
  console.log(`  ${groups.length} property groups`);
  const weights = parseWeights(wtRows);
  console.log(`  ${weights.length} per-stat weights`);

  console.log("\n=== building dependency graph ===");
  const deps = buildDependencies(schematics, slots);

  console.log("\n=== denormalising schematics ===");
  const slotsBySchematic = new Map<string, SchematicSlot[]>();
  for (const s of slots) {
    const arr = slotsBySchematic.get(s.schematicId) ?? [];
    arr.push(s);
    slotsBySchematic.set(s.schematicId, arr);
  }
  const groupsBySchematic = new Map<string, SchematicPropertyGroup[]>();
  for (const g of groups) {
    const arr = groupsBySchematic.get(g.schematicId) ?? [];
    arr.push(g);
    groupsBySchematic.set(g.schematicId, arr);
  }
  const weightsByGroup = new Map<number, SchematicResWeight[]>();
  for (const w of weights) {
    const arr = weightsByGroup.get(w.groupId) ?? [];
    arr.push(w);
    weightsByGroup.set(w.groupId, arr);
  }

  const schematicsOut: SchematicOut[] = schematics.map((s) => ({
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
    slots: (slotsBySchematic.get(s.id) ?? []).map(({ schematicId: _, ...rest }) => rest),
    propertyGroups: (groupsBySchematic.get(s.id) ?? []).map((g) => ({
      id: g.id,
      propertyName: g.propertyName,
      expGroup: g.expGroup,
      weightTotal: g.weightTotal,
      weights: (weightsByGroup.get(g.id) ?? []).map((w) => ({
        stat: w.stat,
        weight: w.weight,
      })),
    })),
  }));

  const now = new Date().toISOString();
  const provenance = {
    generated: now,
    source: "github.com/pwillworth/galaxyharvester/database/seedData",
    sourceCommit: "publish9 branch import, 2019-04-20",
    importer: "scripts/import-gh-seedata.ts",
  };

  await writeFile(
    path.join(outDir, "resource-types.json"),
    `${JSON.stringify({ provenance, types }, null, 2)}\n`,
  );
  await writeFile(
    path.join(outDir, "schematics.json"),
    `${JSON.stringify({ provenance, schematics: schematicsOut, dependencies: deps }, null, 2)}\n`,
  );

  console.log("\n=== output ===");
  console.log(`  reference-data/resource-types.json — ${types.length} types`);
  console.log(`  reference-data/schematics.json — ${schematicsOut.length} schematics, ${deps.length} dep edges`);

  // Sanity: confirm T21 made it through and has dependencies.
  const t21 = schematicsOut.find((s) => s.id === "weapon_rifle_t21");
  if (t21) {
    const t21Deps = deps.filter((d) => d.parentSchematicId === "weapon_rifle_t21");
    console.log(
      `\n  T21 Rifle: ${t21.slots.length} slots, ${t21.propertyGroups.length} property groups, ${t21Deps.length} sub-component edges`,
    );
    for (const d of t21Deps) console.log(`    ${d.slotName} → ${d.childSchematicId}`);
  } else {
    console.error("⚠ T21 Rifle (weapon_rifle_t21) NOT found in output");
  }

  console.log("\n✓ import complete");
}

main().catch((e) => {
  console.error("\n✗ import FAILED:", e);
  process.exit(1);
});
