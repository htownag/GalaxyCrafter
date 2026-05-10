import { ipcMain } from "electron";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { resourceObservations, resourcePlanets, resources, snapshots } from "../db/schema";
import { runIngest } from "../ingest/pipeline";
import type { Resource, RefreshResult, SnapshotSummary } from "../shared/ipc-types";
import galaxiesConfig from "../../reference-data/galaxies.json";

interface GalaxyConfig {
  key: string;
  id: number;
  name: string;
  active: boolean;
}

const galaxiesByKey: Record<string, GalaxyConfig> = Object.fromEntries(
  (galaxiesConfig.galaxies as GalaxyConfig[]).map((g) => [g.key, g]),
);

export function registerIpc(): void {
  ipcMain.handle(
    "snapshot:refresh",
    async (_evt, galaxyKey?: string): Promise<RefreshResult> => {
      const key = galaxyKey ?? galaxiesConfig.default;
      const galaxy = galaxiesByKey[key];
      if (!galaxy) throw new Error(`Unknown galaxy key: ${key}`);
      return await runIngest(galaxy.id);
    },
  );

  ipcMain.handle("snapshot:latest", async (): Promise<SnapshotSummary | null> => {
    const db = getDb();
    const row = db
      .select()
      .from(snapshots)
      .orderBy(desc(snapshots.fetchedAt))
      .limit(1)
      .get();
    return row
      ? {
          id: row.id,
          galaxyId: row.galaxyId,
          fetchedAt: row.fetchedAt,
          resourceCount: row.resourceCount,
        }
      : null;
  });

  ipcMain.handle(
    "resources:list",
    async (_evt, snapshotId?: string): Promise<Resource[]> => {
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

      const rows = db
        .select()
        .from(resources)
        .where(inArray(resources.id, resourceIds))
        .all();

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
    },
  );
}
