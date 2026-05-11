// Orchestrates fetch → parse → upsert for a single ingest run.
// Wrapped in a single SQLite transaction so partial failures don't corrupt
// the snapshot history.

import { randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  inventoryEntries,
  resourceObservations,
  resourcePlanets,
  resources,
  snapshots,
} from "../db/schema";
import type { RefreshResult } from "../shared/ipc-types";
import { fetchCurrentSnapshot } from "./fetcher";
import { parseSnapshot } from "./parser";

export async function runIngest(galaxyId: number): Promise<RefreshResult> {
  const t0 = Date.now();
  const { xml, bytes, url } = await fetchCurrentSnapshot(galaxyId);
  console.log(`[ingest] fetched ${bytes} bytes from ${url}`);

  const parsed = parseSnapshot(xml);
  console.log(`[ingest] parsed ${parsed.resources.length} resources, as_of=${new Date(parsed.asOfDate).toISOString()}`);

  const fetchedAt = Date.now();
  const snapshotId = randomUUID();
  const db = getDb();

  let newCount = 0;
  let autoFlippedCount = 0;
  const snapshotResourceIds = parsed.resources.map((r) => r.id);

  db.transaction((tx) => {
    tx.insert(snapshots)
      .values({
        id: snapshotId,
        galaxyId,
        fetchedAt,
        resourceCount: parsed.resources.length,
      })
      .run();

    for (const r of parsed.resources) {
      const existing = tx.select().from(resources).where(eq(resources.id, r.id)).get();
      if (!existing) {
        newCount++;
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
            oq: r.stats.OQ,
            cr: r.stats.CR,
            cd: r.stats.CD,
            dr: r.stats.DR,
            fl: r.stats.FL,
            hr: r.stats.HR,
            ma: r.stats.MA,
            pe: r.stats.PE,
            sr: r.stats.SR,
            ut: r.stats.UT,
            er: r.stats.ER,
            firstSeenAt: fetchedAt,
            lastSeenAt: fetchedAt,
          })
          .run();
      } else {
        tx.update(resources)
          .set({ lastSeenAt: fetchedAt })
          .where(eq(resources.id, r.id))
          .run();
      }

      tx.insert(resourceObservations)
        .values({ snapshotId, resourceId: r.id })
        .run();

      // Replace planet list for this resource (cheaper than diff-and-patch).
      tx.delete(resourcePlanets).where(eq(resourcePlanets.resourceId, r.id)).run();
      for (const p of r.planets) {
        tx.insert(resourcePlanets).values({ resourceId: r.id, planet: p }).run();
      }
    }

    // Phase 4E: auto-flip live → despawned for any inventory rows whose
    // resource isn't in this snapshot. Cross-character (affects every
    // character on this galaxy that has a stale 'live' entry). Reserved
    // entries are intentionally untouched — they're a player-driven axis
    // and a despawn doesn't change whether units are still earmarked.
    if (snapshotResourceIds.length > 0) {
      const flipped = tx
        .update(inventoryEntries)
        .set({ status: "despawned", updatedAt: fetchedAt })
        .where(
          and(
            eq(inventoryEntries.status, "live"),
            notInArray(inventoryEntries.resourceId, snapshotResourceIds),
          ),
        )
        .returning()
        .all();
      autoFlippedCount = flipped.length;
    }
  });

  const durationMs = Date.now() - t0;
  console.log(
    `[ingest] done in ${durationMs}ms: ${parsed.resources.length} total, ${newCount} new${
      autoFlippedCount > 0 ? `, auto-flipped ${autoFlippedCount} inventory live → despawned` : ""
    }`,
  );

  return {
    snapshot: {
      id: snapshotId,
      galaxyId,
      fetchedAt,
      resourceCount: parsed.resources.length,
    },
    newResourceCount: newCount,
    // TODO Phase 6: diff resource_observations vs prior snapshot for the
    // global despawn count (independent of any character's inventory).
    despawnedResourceCount: 0,
    inventoryAutoFlipped: autoFlippedCount,
    durationMs,
  };
}
