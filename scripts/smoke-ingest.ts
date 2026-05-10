// Standalone smoke test for the ingest pipeline.
// Runs end-to-end (fetch → parse → upsert) against a fresh temp SQLite DB,
// independent of the Electron renderer. Verifies that the Phase 1 data path
// works before the user clicks "Refresh Now" in the live app.
//
// Usage:  pnpm exec tsx scripts/smoke-ingest.ts
// Or:     node_modules/.bin/tsx scripts/smoke-ingest.ts

import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { closeDb, openDb } from "../src/db";
import { resourceObservations, resourcePlanets, resources, snapshots } from "../src/db/schema";
import { runIngest } from "../src/ingest/pipeline";
import { eq, inArray } from "drizzle-orm";

const SR2_GALAXY_ID = 151;

async function main(): Promise<void> {
  const tmpDir = path.join(process.cwd(), "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, "smoke.sqlite");

  // Start clean each run so we exercise the migration + first-insert path.
  if (existsSync(dbPath)) rmSync(dbPath);
  for (const ext of ["-shm", "-wal"]) {
    if (existsSync(dbPath + ext)) rmSync(dbPath + ext);
  }

  const migrationsFolder = path.join(process.cwd(), "drizzle", "migrations");
  const db = openDb(dbPath, migrationsFolder);

  console.log("\n=== running ingest against SR2 (galaxy 151) ===");
  const result = await runIngest(SR2_GALAXY_ID);

  console.log("\n=== INGEST RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  // Sanity checks
  const snapRow = db.select().from(snapshots).get();
  const resourceCount = db.select().from(resources).all().length;
  const observationCount = db.select().from(resourceObservations).all().length;
  const planetRowCount = db.select().from(resourcePlanets).all().length;

  console.log("\n=== DB STATE ===");
  console.log({ snapshots: snapRow ? 1 : 0, resources: resourceCount, observations: observationCount, planets: planetRowCount });

  if (!snapRow) throw new Error("expected one snapshot row");
  if (resourceCount === 0) throw new Error("expected resources to be ingested");
  if (resourceCount !== observationCount) {
    throw new Error(`observation count ${observationCount} should equal resource count ${resourceCount}`);
  }

  // Spot check: variable stat handling. Find an iron_* and gemstone (armophous_*) and
  // confirm they have different stat null patterns.
  const ironRow = db.select().from(resources).where(eq(resources.groupId, "iron")).get();
  const gemRow = db
    .select()
    .from(resources)
    .where(inArray(resources.groupId, ["gemstone_armophous", "gemstone_crystalline_lambent", "gemstone_amorphous"]))
    .get();

  console.log("\n=== STAT NULL PATTERN SPOT CHECK ===");
  if (ironRow) {
    console.log(`iron sample: ${ironRow.name} (${ironRow.typeId})`);
    console.log(`  OQ=${ironRow.oq} CR=${ironRow.cr} CD=${ironRow.cd} DR=${ironRow.dr} HR=${ironRow.hr} MA=${ironRow.ma} SR=${ironRow.sr} UT=${ironRow.ut}`);
    console.log(`  FL=${ironRow.fl} PE=${ironRow.pe} ER=${ironRow.er}  (expect: all null for iron)`);
    if (ironRow.fl !== null || ironRow.pe !== null || ironRow.er !== null) {
      console.warn("⚠ iron resource has non-null FL/PE/ER — variable stat handling likely broken");
    }
  } else {
    console.log("(no iron resource in this snapshot — skip spot check)");
  }
  if (gemRow) {
    console.log(`gemstone sample: ${gemRow.name} (${gemRow.typeId})`);
    console.log(`  OQ=${gemRow.oq} CD=${gemRow.cd} ER=${gemRow.er}  (expect: ER non-null for at least some gemstones)`);
  }

  // Sample first 3 resources for sanity
  console.log("\n=== FIRST 3 RESOURCES ===");
  const first3 = db.select().from(resources).limit(3).all();
  for (const r of first3) {
    console.log(`  ${r.name.padEnd(12)} ${r.typeDisplayName.padEnd(30)} OQ=${r.oq ?? "—"} group=${r.groupId}`);
  }

  closeDb();
  console.log("\n✓ smoke ingest passed");
}

main().catch((e) => {
  console.error("\n✗ smoke ingest FAILED:", e);
  process.exit(1);
});
