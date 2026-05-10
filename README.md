# GalaxyCrafter

Personal-aware SWG resource collection assistant. Built for Sentinels Republic 2; one config switch points it at any other SWGEmu galaxy tracked by [galaxyharvester.net](https://galaxyharvester.net).

**Status:** Phase 1 — Foundation. See `workplan-architecture.md` for the build plan and `design-report.md` for the WHAT.

## Quick start (dev)

```powershell
pnpm install
pnpm dev
```

Opens an Electron window. Click "Refresh Now" to ingest SR2's current resource snapshot from GH.

## Documents

- `design-report.md` — what GalaxyCrafter is (features, principles, killer differentiators)
- `workplan-architecture.md` — how it's built (stack, schema, phased build)
- `research-notes.md` — pre-Phase-1 research outputs (SR2 galaxy ID, Core3 source paths, XML format audit)
- `logbook/` — dated session notes

## Folder layout

```
src/
├── main/        Electron main process (Node-land: DB, ingest, IPC)
├── preload/     contextBridge for renderer
├── renderer/    React UI
├── core/        pure TS — verdict engine, simulator math, scoring
├── ingest/      GH XML pipeline
├── db/          SQLite + Drizzle schema
└── shared/      types shared across processes
reference-data/  bundled JSON (caps, schematics, galaxies)
scripts/        one-off data-import scripts
tests/          vitest + playwright
```

## Stack

Electron · React 19 · Vite · TypeScript · Tailwind v4 · better-sqlite3 · Drizzle ORM · fast-xml-parser · Biome · Vitest · electron-vite · electron-builder.
