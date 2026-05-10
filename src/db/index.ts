import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;
let _raw: Database.Database | null = null;

/**
 * Open the SQLite DB at `dbPath` and run pending migrations from
 * `migrationsFolder`. Idempotent — repeated calls return the same instance.
 *
 * Path-agnostic by design so the same code path serves both the Electron main
 * process (paths from `app.getPath('userData')`) and standalone Node smoke
 * scripts (temp paths).
 */
export function openDb(dbPath: string, migrationsFolder: string): Db {
  if (_db) return _db;

  console.log("[db] opening", dbPath);
  _raw = new Database(dbPath);
  _raw.pragma("journal_mode = WAL");
  _raw.pragma("foreign_keys = ON");

  _db = drizzle(_raw, { schema });

  try {
    migrate(_db, { migrationsFolder });
    console.log("[db] migrations applied from", migrationsFolder);
  } catch (err) {
    console.error("[db] migration failed:", err);
    console.error("[db] hint: run `pnpm db:generate` (or ./node_modules/.bin/drizzle-kit generate) once to create the initial migration");
    throw err;
  }

  return _db;
}

export function getDb(): Db {
  if (!_db) throw new Error("DB not initialised — call openDb() first");
  return _db;
}

export function closeDb(): void {
  if (_raw) {
    _raw.close();
    _raw = null;
    _db = null;
  }
}
