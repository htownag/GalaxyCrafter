# 2026-05-10 — GalaxyCrafter design + workplan complete; pre-Phase-1 starting

## What this session did

- Surveyed the SWG resource-tracking landscape: GalaxyHarvester (open-source Python/MySQL/Apache; daily XML/CSV export at `galaxyharvester.net/exports/current<id>.xml`, refreshed 5pm UTC), HarvesterDroid (Java/JavaFX, 2017, dormant — the prior-art precedent), SWGAide (older Java desktop), and `dpwhittaker/swg-discord-bot` (proves server-direct is technically possible, explicitly out of scope).
- Confirmed SR2's resources auto-upload to GH via the `SR2Updater` bot account, making GH canonical for SR2 spawns with no need to talk to the server directly.
- Wrote `GalaxyCrafter/design-report.md` (~7,000 words). Three killer features: personal-aware verdict engine, crafting simulator (primary use = manufacturing-schematic-bake protection), new-player harvester planner. Six principles, inspectable math first-class.
- All 11 §7 open questions resolved in-session: Electron desktop locked, vanilla schematics only for v1, historical XML import folded into Phase 1, Core3 actual crafting math flagged as the highest-risk pre-Phase-6 item.
- Wrote `GalaxyCrafter/workplan-architecture.md` (~5,500 words). 8 phases over ~12 weekend-units. Stack: Electron + React 19 + Vite + TS + Tailwind + shadcn + Drizzle + better-sqlite3 + Vitest + Playwright + electron-builder. Strict `src/core/` purity boundary for unit-testability of the verdict + simulator math.
- Advisor caught 5 issues during workplan review; all applied: stats moved from `resource_observations` to `resources` entity (immutable per spawn), `schematic_dependencies` as N:M join table (sub-components feed many parents), Core3 Lua as primary schematic source (not GH XML, which is resource-only), historical archive folded into Phase 1 ingest, Core3 C++ crafting-math audit added as mandatory pre-Phase-6 step.

## Artifacts produced

- `GalaxyCrafter/design-report.md`
- `GalaxyCrafter/workplan-architecture.md`
- `GalaxyCrafter/logbook/2026-05-10-design-and-workplan-complete.md` (this file)

## State

- Folder: `GalaxyCrafter/` exists, contains the two design docs and this log. No code yet.
- Branch: `claude/zen-mendeleev-dc1c81` (working in worktree). Not yet committed; merge timing TBD.
- Mod project (extraction-PVP mod) Phase 2 work continues in parallel; GalaxyCrafter is a sibling side-tool, not part of the mod's phase gates.

## What's next — pre-Phase-1 research (this session, continuing)

Three items, ~1-2 hours total:

1. **§6.1** — find SR2's numeric galaxy ID on GH. Record in research notes.
2. **§6.2** — locate Core3 paths for resource caps + schematic data in the WSL `~/workspace/Core3` clone; cross-reference extraction-mod's existing `research/` + `docs/knowledge-base/` for any prior cap-survey work; output `GalaxyCrafter/research-notes.md`.
3. **§6.3** — pull both `current<sr2_id>.xml` and `all<sr2_id>.xml` once; spot-check stats, planets, availability, size; confirm same parser handles both feeds.

**§6.4 (pre-Phase-6) — Core3 C++ crafting math audit — explicitly deferred** until just before Phase 6 starts. Flagged here so future-Claude doesn't forget.

## Open notes

- Sub-component dependency graph assumes Core3 Lua exposes parent → child references cleanly. §6.2 will confirm or surface a problem.
- SR2 galaxy ID is findable several ways: GH home dropdown, SR2Updater user submission URL, or GH GitHub seed data. First one that works.
- Worktree state: clean before this session; will end this session with three new files in `GalaxyCrafter/`. Commit/merge cadence is Ryan's call.
