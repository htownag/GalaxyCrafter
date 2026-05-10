// Threshold-distribution eval. Advisor-mandated check before locking the
// Phase 3 CHASE/MAYBE/SKIP thresholds at 90/70.
//
// Loads the user's existing SQLite DB, applies migrations if needed, runs
// recomputeVerdicts() for each character with at least one active
// schematic, and prints the score-tier histogram.
//
// Usage:
//   pnpm exec tsx scripts/threshold-eval.ts
//
// If `better-sqlite3` can't load under plain Node (Electron ABI mismatch),
// the script bails with a clear hint instead of silently crashing.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { openDb } from "../src/db";
import {
  activeSchematics,
  characters,
  resourceObservations,
  resourceTypes as resourceTypesTable,
  resources as resourcesTable,
  snapshots,
  verdicts,
} from "../src/db/schema";
import { recomputeVerdicts } from "../src/main/verdict/recompute";

function defaultDbPath(): string {
  // Mirrors Electron's app.getPath('userData') on Windows.
  const appData = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
  return path.join(appData, "galaxycrafter", "galaxycrafter.sqlite");
}

async function main(): Promise<void> {
  const dbPath = defaultDbPath();
  if (!existsSync(dbPath)) {
    console.error(`✗ DB not found at ${dbPath}`);
    console.error("  Launch the Electron app at least once to initialise it.");
    process.exit(1);
  }
  const migrationsFolder = path.join(process.cwd(), "drizzle", "migrations");
  console.log(`[eval] opening ${dbPath}`);
  const db = openDb(dbPath, migrationsFolder);

  // Quick sanity on the inputs.
  const totalResources = db.select({ c: sql<number>`count(*)` }).from(resourcesTable).get();
  const totalSnapshots = db.select({ c: sql<number>`count(*)` }).from(snapshots).get();
  const totalTypes = db.select({ c: sql<number>`count(*)` }).from(resourceTypesTable).get();
  console.log(
    `[eval] DB has ${totalResources?.c ?? 0} lifetime resources, ${totalSnapshots?.c ?? 0} snapshots, ${totalTypes?.c ?? 0} resource types loaded`,
  );

  const allChars = db.select().from(characters).all();
  if (allChars.length === 0) {
    console.error("✗ No characters in DB. Create one + add T21 first.");
    process.exit(1);
  }

  for (const c of allChars) {
    const active = db
      .select()
      .from(activeSchematics)
      .where(eq(activeSchematics.characterId, c.id))
      .all();
    console.log(
      `\n[eval] character "${c.name}" (galaxy ${c.galaxyId}) — ${active.length} active schematics`,
    );
    if (active.length === 0) {
      console.log("  no active schematics — skipping");
      continue;
    }

    // Sanity: snapshot freshness for this galaxy.
    const latest = db
      .select()
      .from(snapshots)
      .where(eq(snapshots.galaxyId, c.galaxyId))
      .orderBy(sql`fetched_at DESC`)
      .limit(1)
      .get();
    if (!latest) {
      console.log("  no snapshot for this galaxy — skipping");
      continue;
    }
    const obsCount = db
      .select({ c: sql<number>`count(*)` })
      .from(resourceObservations)
      .where(eq(resourceObservations.snapshotId, latest.id))
      .get();
    console.log(
      `  latest snapshot ${latest.id} — ${obsCount?.c ?? 0} resources, fetched ${new Date(latest.fetchedAt).toISOString()}`,
    );

    const result = recomputeVerdicts(c.id);
    console.log(
      `  recompute: ${result.chase} CHASE / ${result.maybe} MAYBE / ${result.resourcesScored} scored / ${result.verdictsWritten} written in ${result.durationMs}ms`,
    );

    // Re-read the verdicts table for a fuller histogram.
    const allVerdicts = db.select().from(verdicts).where(eq(verdicts.characterId, c.id)).all();

    if (allVerdicts.length > 0) {
      // Bucket scores into deciles.
      const buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 0..9, with 10th holding "100"
      for (const v of allVerdicts) {
        const b = Math.min(10, Math.floor(v.topScore / 10));
        buckets[b]++;
      }
      console.log("  score histogram (deciles of topScore):");
      for (let i = 0; i < buckets.length; i++) {
        const lo = i * 10;
        const hi = i === 10 ? 100 : (i + 1) * 10 - 1;
        if (buckets[i] === 0) continue;
        const bar = "█".repeat(Math.min(40, buckets[i]));
        console.log(
          `    ${String(lo).padStart(3)}-${String(hi).padStart(3)}: ${String(buckets[i]).padStart(4)} ${bar}`,
        );
      }

      // Top 10 highest scoring resources to spot-check.
      const top = [...allVerdicts].sort((a, b) => b.topScore - a.topScore).slice(0, 5);
      console.log("  top 5 by score:");
      for (const v of top) {
        console.log(`    ${v.topScore.toFixed(1).padStart(5)} ${v.tier}`);
      }
    }
  }
}

main().catch((e) => {
  console.error("\n✗ eval failed:", e);
  if (String(e).includes("NODE_MODULE_VERSION")) {
    console.error(
      "  better-sqlite3 was built for Electron's ABI; this script can't run under plain Node.",
    );
    console.error("  Run via the Electron main process instead, or temporarily rebuild for Node:");
    console.error("    pnpm rebuild better-sqlite3");
    console.error("  (then `./node_modules/.bin/electron-builder install-app-deps` after.)");
  }
  process.exit(1);
});
