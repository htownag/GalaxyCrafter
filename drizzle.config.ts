import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
  // Migrations run from the main process at startup via better-sqlite3;
  // drizzle-kit is only used here for generating the SQL files.
});
