# GalaxyCrafter — Workplan & Architecture

**Project:** GalaxyCrafter
**Author:** Ryan, with Claude
**Date:** 2026-05-10
**Status:** Initial draft. Companion to `design-report.md` (the WHAT); this is the HOW.

---

## 0. Purpose and relationship to the design doc

`design-report.md` defines what GalaxyCrafter is: principles, features, the three killer differentiators (personal-aware verdict engine, crafting simulator with manufacturing-schematic-bake protection, new-player harvester planner), open questions resolved 2026-05-10.

This document is the engineering plan. It locks in the remaining technology choices, defines the repo layout and data model, breaks the work into ordered phases with rough-time estimates, and lists the pre-Phase-1 action items that have to be settled before code starts.

Anything not explicitly decided here defers to "we'll find out during Phase X" — over-specifying upfront is wasted ink for a solo, iterative build.

---

## 1. Tech stack

### 1.1 Locked by the design doc

- **Electron** (desktop app, Windows primary, macOS / Linux plausible later) — §9 of design.
- **SQLite** (local persistence) — §9 of design.
- **Local-first, single-user** — no auth, no cloud, no shared service — §3.5 of design.

### 1.2 This document's additional choices

| Layer                | Choice                          | Rationale                                                                                            |
|----------------------|---------------------------------|------------------------------------------------------------------------------------------------------|
| Language             | TypeScript                       | Single language across main + renderer + core; type safety pays off on a multi-month build.          |
| Renderer framework   | **React 19** + Vite              | Largest ecosystem; highest density of AI-pair-dev signal; well-known to Ryan via the Unity MOBA work.|
| State                | Zustand                          | Minimal API, no boilerplate, sufficient for an app of this scope.                                    |
| Routing              | React Router v7                  | Standard.                                                                                            |
| Styling              | Tailwind CSS v4                  | Aligns with the cards-over-rows, progress-bars-not-numbers UI principles.                            |
| Component primitives | shadcn/ui (Radix-based)          | Copy-paste, no runtime dep bloat. Default for 2026 React desktop apps.                               |
| SQLite driver        | better-sqlite3                   | Synchronous, fast, ideal for an Electron main-process embedded DB.                                   |
| ORM                  | Drizzle ORM                      | Typed, lightweight, no codegen surprises.                                                            |
| Lint / format        | Biome                            | Single tool, fast; replaces ESLint + Prettier in 2026.                                               |
| Unit test            | Vitest                           | Native TS, fast, Vite-aligned.                                                                       |
| E2E test             | Playwright + electron-playwright | Standard for Electron e2e in 2026.                                                                   |
| Build / packaging    | Vite (renderer) + electron-builder | electron-builder handles Windows installer, macOS DMG, Linux AppImage cleanly.                       |
| Package manager      | pnpm                             | Workspaces (if ever needed), faster installs, stricter hoisting.                                     |
| Notifications        | Electron `Notification` API      | Native OS toast; no extra dependency.                                                                |
| HTTP                 | undici (Node built-in fetch)     | Built-in to Node 22+; no axios.                                                                      |
| XML parser           | fast-xml-parser                  | Mature, fast, sufficient for GH's well-formed XML.                                                   |
| Scheduling           | node-cron                        | Tiny library; runs the 12h ingest cron.                                                              |

Off the table: Java/JavaFX (per design §9), any heavy backend framework (Express, Fastify) — there is no backend; everything runs in-process. No GraphQL, no tRPC — internal IPC types are enough.

### 1.3 What the renderer is *not*

- Not server-side-rendered. There's no server.
- Not a route-based SPA-as-distinct-app. It's an Electron renderer that uses React Router for navigation between in-window views.
- Not styled with CSS-in-JS runtime libraries (no Emotion, no styled-components). Tailwind is build-time only.

---

## 2. Repo layout

Single package, single Electron app. No monorepo split — the app is too small to justify the extra workspace boundaries.

```
GalaxyCrafter/
├── design-report.md              # the WHAT
├── workplan-architecture.md      # the HOW (this doc)
├── README.md                     # user-facing readme; install + run
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.node.json            # tsconfig for main process
├── biome.json
├── vite.config.ts
├── electron-builder.yml
├── .gitignore
│
├── src/
│   ├── main/                     # Electron main process (Node-land)
│   │   ├── index.ts              # app bootstrap, window mgmt
│   │   ├── ipc.ts                # typed IPC handlers
│   │   ├── scheduler.ts          # node-cron jobs (12h ingest)
│   │   └── db.ts                 # SQLite connection + migration runner
│   │
│   ├── preload/                  # context-bridge surface for renderer
│   │   └── index.ts
│   │
│   ├── renderer/                 # React UI
│   │   ├── App.tsx
│   │   ├── main.tsx              # Vite entry
│   │   ├── routes/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Resources.tsx
│   │   │   ├── Schematics.tsx
│   │   │   ├── Inventory.tsx
│   │   │   ├── Simulator.tsx
│   │   │   ├── NewPlayer.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/
│   │   │   ├── ResourceCard.tsx
│   │   │   ├── VerdictPill.tsx
│   │   │   ├── StatBar.tsx
│   │   │   ├── DespawnTimer.tsx
│   │   │   └── ...
│   │   ├── hooks/                # custom hooks (useResources, useVerdicts)
│   │   ├── stores/               # Zustand stores
│   │   └── lib/                  # renderer utilities
│   │
│   ├── core/                     # PURE TS, no Electron / DOM / DB imports
│   │   ├── verdict/              # scoring + verdict tier logic
│   │   │   ├── score.ts
│   │   │   ├── verdict.ts
│   │   │   └── sb-flags.ts
│   │   ├── simulator/            # SWG crafting math
│   │   │   ├── assembly.ts
│   │   │   ├── experimentation.ts
│   │   │   └── compare.ts
│   │   ├── schematic/            # dependency graph + priority inheritance
│   │   │   ├── dependency-graph.ts
│   │   │   └── priority.ts
│   │   ├── new-player/           # harvester allocation + survey route
│   │   │   └── planner.ts
│   │   └── types.ts              # shared domain types
│   │
│   ├── ingest/                   # GH XML pipeline
│   │   ├── fetcher.ts            # download current<id>.xml
│   │   ├── parser.ts             # fast-xml-parser → typed objects
│   │   ├── differ.ts             # diff vs previous snapshot
│   │   └── pipeline.ts           # orchestrates fetch → parse → upsert
│   │
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema (single source of truth)
│   │   ├── migrations/           # Drizzle migration files
│   │   └── queries/              # named query functions
│   │
│   └── shared/                   # types used across main + renderer
│       └── ipc-types.ts
│
├── reference-data/               # bundled static reference
│   ├── resource-types.json       # caps per type (imported from Core3)
│   ├── schematics.json           # vanilla schematic library
│   ├── professions.json          # profession → crafting tabs mapping
│   └── README.md                 # provenance of each file
│
├── tests/
│   ├── unit/                     # vitest, core/ functions
│   ├── integration/              # ingest pipeline with fixture XML
│   ├── fixtures/
│   │   └── sample-gh-export.xml
│   └── e2e/                      # playwright
│
└── scripts/                      # one-off dev scripts
    ├── import-core3-caps.ts      # parse Core3 Lua → resource-types.json
    ├── import-gh-schematics.ts   # parse a GH dump → schematics.json
    └── validate-simulator.ts     # run §7.6 validation harness
```

### 2.1 Why this layout

- **`src/core/` is pure.** No Electron, no DOM, no DB imports allowed. Everything in `core/` is unit-testable with Vitest in milliseconds. The verdict engine, the simulator math, the sub-component dependency graph all live here. This is the project's correctness surface and isolating it pays for the discipline.
- **`src/ingest/` is pure-Node** — runs in the main process or in tests with no DOM.
- **`src/db/` is the only place that touches SQLite.** Renderer never imports Drizzle directly; it goes through IPC.
- **`reference-data/` is committed JSON.** Treated as source of truth; updates happen via the `scripts/` tools and a fresh commit. No live downloads at install time.
- **`scripts/` are one-shot.** Don't ship; just used during dev to refresh `reference-data/`.

### 2.2 Process model and IPC

Three Electron processes (standard pattern):

```
┌────────────────────┐         ┌────────────────────┐         ┌────────────────────┐
│   Main process     │◄────────┤   Preload script   ├────────►│   Renderer (UI)    │
│   (Node, SQLite)   │   IPC   │   (context bridge) │ window  │   (React)          │
└────────────────────┘         └────────────────────┘         └────────────────────┘
        │
        │ schedules + runs ingest
        ▼
   ┌────────────┐
   │  src/      │
   │  ingest/   │ ───► SQLite ───► broadcasts IPC event "snapshot-updated"
   └────────────┘
```

**IPC contract is typed.** `src/shared/ipc-types.ts` exports request / response types; the preload bridge maps them to `ipcRenderer.invoke('channel', args)` calls. Renderer code never sees raw `ipcRenderer` — it uses typed wrapper functions exposed on `window.api`.

Example:

```ts
// src/shared/ipc-types.ts
export type IpcChannel = {
  'snapshot:latest': { req: void; res: SnapshotSummary };
  'resources:list':  { req: { snapshotId: string }; res: ResourceWithVerdict[] };
  'inventory:add':   { req: { resourceId: string; units: number }; res: void };
  'simulator:run':   { req: SimulatorConfig; res: SimulatorOutput };
  // ...
};
```

Renderer subscribes to push events for live updates:

```ts
window.api.on('snapshot-updated', (summary) => { /* refresh UI */ });
```

---

## 3. Data model

The full SQLite schema, sketched at the level needed to drive Phase 1-2. Real Drizzle definitions go in `src/db/schema.ts`; Drizzle generates migrations from there.

### 3.1 Reference tables (bundled, populated at install / app version bump)

```sql
resource_types (
  id            TEXT PRIMARY KEY,           -- 'aakuran_steel', 'polysteel_copper'
  name          TEXT NOT NULL,
  parent_id     TEXT,                       -- tree hierarchy (Steel -> Aakuran, Aakuran -> Class V)
  group_id      TEXT,                       -- 'mineral_metal_ferrous' etc.
  cap_oq INTEGER, cap_cr INTEGER, cap_cd INTEGER, cap_dr INTEGER,
  cap_fl INTEGER, cap_hr INTEGER, cap_ma INTEGER, cap_pe INTEGER,
  cap_sr INTEGER, cap_ut INTEGER, cap_er INTEGER,
  floor_oq INTEGER, floor_cr INTEGER, ...   -- same 11 floors
)

resource_groups (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  category_id   TEXT
)

schematics (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  profession      TEXT NOT NULL,             -- 'weaponsmith', 'artisan'
  crafting_tab    TEXT
  -- N:M parent/child relationships live in schematic_dependencies below
)

schematic_dependencies (
  parent_schematic_id   TEXT REFERENCES schematics(id),
  child_schematic_id    TEXT REFERENCES schematics(id),
  PRIMARY KEY (parent_schematic_id, child_schematic_id)
  -- N:M — a sub-component like Light Power Source can be a child of many parent weapons
)

schematic_slots (
  id                 TEXT PRIMARY KEY,
  schematic_id       TEXT REFERENCES schematics(id),
  slot_name          TEXT,                   -- 'core', 'barrel', 'stock'
  accepted_type_id   TEXT REFERENCES resource_types(id),
  -- if a slot accepts a sub-component output rather than raw resource:
  accepted_subcomponent_schematic_id TEXT REFERENCES schematics(id),
  units_required     INTEGER
)

schematic_property_groups (
  id              TEXT PRIMARY KEY,
  schematic_id    TEXT REFERENCES schematics(id),
  property_name   TEXT                       -- 'damage', 'speed', 'wound_chance'
)

schematic_property_weights (
  group_id   TEXT REFERENCES schematic_property_groups(id),
  stat       TEXT,                            -- 'OQ', 'CD', etc.
  weight     REAL                             -- 0.0–1.0; sum per group = 1.0
)
```

### 3.2 Snapshot + live-spawn tables (populated by ingest)

```sql
snapshots (
  id            TEXT PRIMARY KEY,             -- UUID
  galaxy_id     INTEGER,
  fetched_at    INTEGER,                      -- unix ms
  raw_xml_path  TEXT,                         -- relative path to compressed archive
  resource_count INTEGER
)

resources (
  id           TEXT PRIMARY KEY,              -- GH resource id
  name         TEXT NOT NULL,
  type_id      TEXT REFERENCES resource_types(id),
  entered_by   TEXT,                          -- GH submitter user
  added_date   INTEGER,                       -- unix ms; resource lifecycle start
  galaxy_id    INTEGER,
  -- a resource's 11 stats are IMMUTABLE after it spawns — they live on the entity, not the observation:
  oq INTEGER, cr INTEGER, cd INTEGER, dr INTEGER,
  fl INTEGER, hr INTEGER, ma INTEGER, pe INTEGER,
  sr INTEGER, ut INTEGER, er INTEGER
)

resource_observations (
  snapshot_id  TEXT REFERENCES snapshots(id),
  resource_id  TEXT REFERENCES resources(id),
  available    INTEGER,                       -- 0/1 (GH availability flag — the only thing that varies snapshot-to-snapshot)
  PRIMARY KEY (snapshot_id, resource_id)
)

resource_planets (
  resource_id  TEXT REFERENCES resources(id),
  planet       TEXT,
  PRIMARY KEY (resource_id, planet)
)

waypoints (
  id           TEXT PRIMARY KEY,
  resource_id  TEXT REFERENCES resources(id),
  planet       TEXT,
  x            REAL,
  y            REAL,
  concentration INTEGER,                       -- 0-100
  source       TEXT                            -- 'gh' or 'local'
)
```

### 3.3 User-state tables

```sql
characters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  galaxy_id   INTEGER,
  created_at  INTEGER
)

profession_priorities (
  character_id  TEXT REFERENCES characters(id),
  profession    TEXT,
  tier          TEXT,                          -- 'primary' | 'secondary' | 'ignored'
  rank          INTEGER,                       -- within tier
  PRIMARY KEY (character_id, profession)
)

active_schematics (
  character_id          TEXT REFERENCES characters(id),
  schematic_id          TEXT REFERENCES schematics(id),
  source                TEXT,                  -- 'user' | 'inherited'
  parent_schematic_id   TEXT,                  -- set when source = 'inherited'
  PRIMARY KEY (character_id, schematic_id)
)

owned_resources (
  character_id  TEXT REFERENCES characters(id),
  resource_id   TEXT REFERENCES resources(id),
  units         INTEGER,
  status        TEXT,                          -- 'live' | 'banked' | 'reserved'
  notes         TEXT,
  PRIMARY KEY (character_id, resource_id)
)
```

### 3.4 Derived tables (recomputed on every snapshot or inventory change)

```sql
verdicts (
  resource_id      TEXT REFERENCES resources(id),
  character_id     TEXT REFERENCES characters(id),
  snapshot_id      TEXT REFERENCES snapshots(id),
  tier             TEXT,                       -- 'CHASE' | 'MAYBE' | 'SKIP'
  reason_text      TEXT,
  breakdown_json   TEXT,                       -- per-schematic, per-group scores
  computed_at      INTEGER,
  PRIMARY KEY (resource_id, character_id, snapshot_id)
)

sb_flags (
  resource_id      TEXT REFERENCES resources(id),
  snapshot_id      TEXT REFERENCES snapshots(id),
  flag             TEXT,                       -- 'SB_TOP_for_Architect'
  for_profession   TEXT,
  PRIMARY KEY (resource_id, snapshot_id, flag)
)
```

### 3.5 Simulator state

```sql
simulator_variants (
  id                TEXT PRIMARY KEY,
  schematic_id      TEXT REFERENCES schematics(id),
  character_id      TEXT REFERENCES characters(id),
  name              TEXT,
  slot_config_json  TEXT,                      -- which resource in which slot
  predicted_json    TEXT,                      -- output stats predicted
  cost_annotations_json TEXT,                  -- per-slot buy cost annotations
  saved_at          INTEGER
)
```

### 3.6 Settings

```sql
settings (
  key    TEXT PRIMARY KEY,
  value  TEXT                                  -- JSON-encoded
)
-- example keys:
--   'verdict.thresholds'    => {"chase":8,"maybe":3,"sb_top":1.0,"sb_near":0.95}
--   'ingest.intervalHours'  => 12
--   'ui.layout'             => "cards"
--   'character.active'      => "<character_id>"
```

### 3.7 Storage growth strategy

Each snapshot adds ~5,000 resource_observations rows (rough estimate for SR2 active spawns). At 2 snapshots/day that's ~3.6M rows/year. Acceptable, but we'll add a retention policy in Phase 1: keep raw observations for 90 days rolling, then compact older snapshots into a `resource_history` aggregate (max stats per resource per month, sufficient for "did this resource ever spawn better than X" queries). Settings-configurable, defaulting to 90 days.

---

## 4. Phased build plan

Each phase produces a visibly working slice. Estimates are weekend-units (~6-10 productive hours per weekend, solo + Claude pair). Total: ~12 weekends of focused effort, realistically 3-5 months of calendar time given Ryan's parallel mod-development load.

### Phase 1 — Foundation (1 weekend)

**Goal:** Electron window opens. A button fetches the SR2 XML from GH and stores it in SQLite. A list view shows the spawning resources, raw.

- `pnpm init`; install Electron 32+, Vite 5+, React 19, TypeScript 5.5+, Tailwind v4, better-sqlite3, Drizzle, fast-xml-parser, undici, node-cron, Vitest, Playwright.
- Electron skeleton: main process opens a window pointing at the Vite dev server.
- Preload bridge with one round-trip IPC call as smoke test.
- SQLite connection via `better-sqlite3` opened in `app.getPath('userData')`.
- Drizzle schema for: `snapshots`, `resources`, `resource_observations`, `resource_planets`. Migration runs on app start.
- `src/ingest/`: fetcher (downloads `current<galaxyId>.xml`; `all<id>.xml` is **404 / not publicly served** — see §6.3 finding), parser (xml → typed objects), pipeline (orchestrates upsert). Every ingest also appends a row to `resources_seen` (a thin lifetime-union table keyed on resource id) — this is the self-accumulating history that feeds Phase 4 inventory autocomplete.
- Renderer: a `Resources` route that calls IPC `resources:list-latest` and renders a basic HTML table.
- Manual "Refresh Now" button in UI triggers an ingest.

**Exit criteria:** Click button, wait ≤30s, see ~5,000 SR2 resources in a table with all 11 stats.

**Out of scope for Phase 1:** styling, verdict logic, resource type lookup, schematics, characters.

### Phase 2 — Reference data + schematics (1 weekend)

**Goal:** Resource type tree imported with caps. Schematic library imported with property weights. Active schematic list works for a single character.

- `scripts/import-core3-caps.ts` — pulls resource type definitions and caps from the local Core3 clone in WSL2. Outputs `reference-data/resource-types.json`. (Pre-Phase-1 action item §6 below identifies the exact source paths.)
- `scripts/import-core3-schematics.ts` — **primary source: vanilla Core3 Lua schematic definitions** in `~/workspace/Core3/MMOCoreORB/bin/scripts/managers/crafting/` (exact paths confirmed in §6.2). Outputs `reference-data/schematics.json`. N:M parent / sub-component relationships preserved as `schematic_dependencies` rows. Core3 Lua is authoritative — it's the actual server math SR2 runs against. (GH's daily XML is resource-only and is not a schematic source; see §9.2.)
- Drizzle schema for: `resource_types`, `resource_groups`, `schematics`, `schematic_slots`, `schematic_property_groups`, `schematic_property_weights`, `characters`, `profession_priorities`, `active_schematics`.
- App start checks reference-data versions and refreshes the corresponding DB tables if changed.
- Character creation modal (single character for now): name, galaxy, profession priorities.
- Schematic browser route: list with filter by profession + tab. Click → schematic detail showing slots + property groups.
- Active schematic list UI: add / remove schematics for the active character.

**Exit criteria:** Create a Weaponsmith-primary character. Add T21 Heavy Carbine to active schematics. See it in the list with its expected ingredient slots and property weights.

### Phase 3 — Verdict engine + sub-component dependency graph (2 weekends)

**Goal:** Every resource gets a personal verdict + SB flags. Adding a parent schematic cascades sub-components with transitive priority. The breakdown panel shows the math.

- `src/core/verdict/score.ts` — pure function: `score(resource, schematicGroup, weights) => number`. Unit tested heavily.
- `src/core/verdict/verdict.ts` — pure function: `verdict(resource, character, snapshot, ownedResources) => Verdict`. Includes the roll-up logic from design §5.2.6. Unit tested with worked examples from design §5.2.8.
- `src/core/verdict/sb-flags.ts` — computes SB_TOP / SB_NEAR per profession across the snapshot. Pure.
- `src/core/schematic/dependency-graph.ts` — given a schematic, returns its full sub-component tree. Used by both verdict roll-up and simulator recursion.
- `src/core/schematic/priority.ts` — transitive priority inheritance for sub-components.
- IPC handler `verdicts:recompute` — runs the engine across all spawning resources for the active character; writes to `verdicts` table; emits `verdicts-updated` event.
- Renderer: verdict pill component (`CHASE` / `MAYBE` / `SKIP` colors), SB flag chips, click-to-expand breakdown panel.
- "Add sub-components?" prompt when activating a parent schematic.

**Exit criteria:** Add T21 Heavy Carbine + confirm sub-components. Run a fresh ingest. Resource list now shows verdicts; click a CHASE pill, see the full breakdown including which sub-component slot the resource fills and what the inherited priority is.

### Phase 4 — Inventory (1 weekend)

**Goal:** My Crates UI. Manual entry with autocomplete. Owned-aware verdicts.

- Drizzle schema: `owned_resources`.
- "Add to inventory" flow: autocomplete from the `resources_seen` self-accumulating history table (Phase 1 ingest grows it on every refresh). Pre-fills all 11 stats for any resource the app has ever seen. **First-run gap:** resources Ryan harvested before installing the app are *not* in `resources_seen` until they spawn again on SR2 (or until Ryan grabs a one-time `all151.xml` from a logged-in GH session and drops it into `reference-data/seed-history.xml` for one-shot import — optional convenience; see `research-notes.md` §7.1 for alternatives). For pre-app resources not yet in the history table, the autocomplete falls back to type-only matching (pick the resource type from `reference-data/resource-types.json`, then enter the 11 stats by hand with cap/floor hints alongside each input).
- My Crates route: per-character list of owned, grouped by status.
- Verdict engine pulls `owned_resources` for the active character into its inputs; `score_owned` now driven by real data.
- After any inventory mutation, verdict recompute fires; renderer reflects the change without page reload.

**Exit criteria:** Add three Aakuran Steel entries (different stat lines) to inventory. A new lower-stat Aakuran spawning gets downgraded to `SKIP`. Drill in, see the comparison.

### Phase 5 — Dashboard (1-2 weekends)

**Goal:** The dashboard from design §5.1 is the home view. Three lanes plus inventory health.

- Dashboard route: lane layout (Right Now / On Watch / SB Collection / Inventory Health).
- ResourceCard component: name, type, top-2 stat progress bars, planet, despawn timer, verdict pill, SB chips, one-line reason.
- StatBar component: percent-of-cap progress bar with hover-revealed absolute value.
- DespawnTimer component: color-coded by hours remaining.
- Cards / rows toggle on every list view; preference persisted.
- Live diff toast component listening to `snapshot-updated` IPC event.
- Keyboard triage on focus: `c` / `s` / `?` / `r` / `j` / `k` / `/`.
- Settings: verdict thresholds, layout default, theme (light / dark).

**Exit criteria:** Open the app, see a personalised dashboard. Triage the top 5 spawns in under 30 seconds using only keyboard.

### Phase 6 — Crafting simulator (2-3 weekends)

**Goal:** Pick a schematic, see what comes off the line. A-vs-B compare. Cost-annotated ROI.

- `src/core/simulator/assembly.ts` — implements assembly-success math (weighted MA, skill, tool, station).
- `src/core/simulator/experimentation.ts` — implements per-property-group experimentation roll, with the 960 threshold and the multi-property compensation factor.
- `src/core/simulator/compare.ts` — A-vs-B delta computation with cost ROI.
- Simulator UI: two-pane layout. Left = slot config (per-slot resource picker: from inventory / from current spawns / hypothetical with manual stats). Right = predicted output per experimental property group with stat bars.
- A-vs-B toggle splits the right pane.
- Variant history sidebar.
- Cost annotations per slot; sale-price + price-elasticity per schematic.
- Recurses into sub-component schematics when the active list contains them.
- Saved variants persisted to `simulator_variants`.

**Exit criteria:** Simulate a T21 Heavy Carbine from owned inventory. Save baseline. Swap one slot to a hypothetical "auction" resource. See the delta in predicted damage and ROI breakeven. Save variant B. Switch back to baseline.

### Phase 7 — New-player mode (1-2 weekends)

**Goal:** Empty inventory triggers the planning workflow. Harvester allocation solver. Survey route ordering.

- Detection: if `count(owned_resources) < threshold` AND `count(active_schematics) > 0`, dashboard shows new-player mode entry.
- `src/core/new-player/planner.ts`:
  - **Step 1** — surface top 10 currently-spawning resources for the priority profession's most common slots.
  - **Step 2** — harvester allocation solver: given K lots, choose K planets that maximise weighted coverage. Greedy with one-pass refinement is sufficient for K ≤ 5.
  - **Step 3** — survey route per planet: ordered list with planet, waypoint, concentration, despawn timer.
- UI: step-by-step layout with progress indicator.
- Checklist persistence: mark targets surveyed; once threshold of inventory is met, dashboard returns to standard mode.

**Exit criteria:** Roll a fresh Weaponsmith-primary character on the test profile. Get a deterministic week-one workflow: 3 harvester planet picks with reasoning, ordered hand-survey list.

### Phase 8 — Polish, notifications, multi-character (1-2 weekends)

**Goal:** The bells.

- Desktop OS notifications via Electron `Notification` API; opt-in per verdict tier and per SB flag.
- Optional Discord webhook posting on `CHASE` and subscribed SB events.
- Multi-character profile UI: add / switch / archive characters; dashboard rolls up across active characters.
- Theme polish: light theme parity, custom CSS variable hooks.
- Custom verdict thresholds, profession rules, per-resource overrides.
- Drag-and-drop import of `.mail` files for survey droid parsing (basic v1; OCR deferred per design §7.5).
- Export / import full config + inventory as one JSON file.

**Exit criteria:** Tool is usable for daily SR2 weaponsmithing. Notifications fire correctly on a fresh CHASE. A second character can be added and the dashboard reflects both.

---

## 5. Critical path and dependencies

```
Phase 1 (foundation)
   │
   ▼
Phase 2 (reference data + schematics)
   │
   ▼
Phase 3 (verdict engine + dependency graph)  ────►  Phase 6 (simulator) can start in parallel
   │                                                    once 3 is partly done
   ▼
Phase 4 (inventory)                          ────►  feeds back into Phase 3 verdicts
   │
   ▼
Phase 5 (dashboard)
   │
   ▼
Phase 7 (new-player mode)                    ────►  needs Phases 2, 3, 5
   │
   ▼
Phase 8 (polish)
```

**Hard prerequisites:**
- Phase 2 before Phase 3 (need schematic data to score against).
- Phase 3 before Phase 4 (inventory only matters if verdicts use it).
- Phase 5 can technically come earlier, but the dashboard isn't interesting without verdicts (Phase 3).
- Phase 6 needs Phases 2 + 3 (schematic + dependency graph). Inventory (Phase 4) is needed for "from inventory" slot picker; without it the simulator falls back to "from current spawns" only.
- Phase 7 needs Phases 2 + 3 + at minimum Phase 5's card components.

**Soft dependencies:**
- Phase 5 (dashboard) and Phase 6 (simulator) can swap order if you'd rather see the simulator working before polishing the dashboard.
- Phase 8 (polish) is a backstop — items inside can be pulled forward whenever they pay off.

---

## 6. Pre-phase research and setup

Two batches. §6.1–6.3 are pre-Phase-1 — an hour or two before any code starts. §6.4 is pre-Phase-6 — done much later, before the crafting simulator is written. Skipping §6.4 is the single biggest risk in this plan.

**§6.1–6.3 completed 2026-05-10.** Full findings in `GalaxyCrafter/research-notes.md`. Key results: SR2 galaxy ID = **151**; resource caps live in `resource_tree.iff` (already extracted to main project at `research/resource-tree-vanilla/`); schematics are IFF files referenced from `bin/scripts/managers/crafting/schematics.lua`; SWG-Forge `@swgemu/core` parses both. **Two findings changed the workplan: `all<id>.xml` returns 404 publicly** (historical-archive plan revised — see Phase 1 / Phase 4 below); and **waypoints are not in the daily export** (design §5.13 GH-waypoint pass-through deferred to v2).

### 6.1 Find the SR2 galaxy ID on GH (§7.8 of design)

Browse to any SR2 resource on `galaxyharvester.net` (sort by recent activity, pick a recent SR2 spawn). The URL will contain `?galaxy=<id>`. Record it. Lives in `reference-data/galaxies.json` as `{"sr2": <id>, ...}` for future multi-galaxy support.

### 6.2 Locate Core3 paths for resource caps AND schematic data (§7.7 of design)

The vanilla Core3 codebase lives in WSL at `~/workspace/Core3`. **Authoritative source for both resource caps and schematic library** (per §9.2 — GH XML is resource-only and not a schematic source).

Likely paths:
- `MMOCoreORB/bin/scripts/managers/crafting/` — schematic definitions: ingredient slots, experimental property groups, per-stat weights, and parent → sub-component references.
- `MMOCoreORB/bin/scripts/managers/resource/` (or similar) — resource group / type definitions with min/max stat ranges.

Cross-reference extraction-mod's existing `research/` folder for any prior cap-survey work that may shortcut this.

Output: `GalaxyCrafter/research-notes.md` (a new file), listing exact source paths for:
- Resource type tree + per-type caps and floors for all 11 stats
- Schematic library (vanilla) with slots + property weights
- N:M parent / sub-component schematic relationships (feeds `schematic_dependencies` table — §3.1)

### 6.3 Audit GH XML against expectations

Pull the SR2 current export once manually:
```
curl https://galaxyharvester.net/exports/current<sr2_id>.xml > /tmp/sr2.xml
```

Spot-check:
- Are all 11 stats present and well-formed?
- Is there a `<resourceType>` element that maps cleanly to the cap database?
- Does the file include planet info per resource?
- Are availability flags present?
- Approximate size (rows, file MB)?

**2026-05-10 result:** `current151.xml` validated — 484 resources, ~178KB, ISO-8859-15, clean structure. One schema clarification: stat tags vary per resource type (iron has 8 of 11 stats; gemstones have a different 8 including ER; missing stat ≠ value 0). Schema columns are nullable INTEGERs (correct as designed); verdict engine must treat NULL as "stat not applicable" not 0.

**The historical archive (`all<id>.xml`) returns 404** for SR2 and for every other galaxy ID tested. The public endpoint is `current<id>.xml` only. Phase 4 inventory autocomplete is revised to use a self-accumulating history table instead (see Phase 1 and Phase 4 below; full alternatives discussed in `research-notes.md` §7.1).

### 6.4 Pre-Phase-6 — audit Core3's actual crafting math (highest-risk item in the plan)

**Done before Phase 6 starts, not before Phase 1.** This is the single most important pre-condition for the simulator working.

Published SWG wikis describe live-SWG crafting formulas including a "compensation factor" for multi-property experimentation that has no numerical value documented. Core3's C++ reimplementation may differ from the wiki formulas. The simulator's predictions must match what SR2's server actually does, not what the wikis describe — or §7.4 validation will fail and Phase 6 burns weeks tuning a formula that doesn't match reality.

Action:
- Grep Core3 C++ under `~/workspace/Core3/MMOCoreORB/src/server/zone/managers/crafting/` (and related crafting subsystems) for the actual assembly-success and experimentation formulas.
- Document the exact formulas used (assembly success, experimentation roll, MA weighting, multi-property compensation factor) in `GalaxyCrafter/research-notes.md` under a `crafting-math` section.
- Phase 6 implementation matches this source verbatim, not the wikis.

Estimated effort: half a day of reading + summarising. Must complete before any simulator code is written.

---

## 7. Testing strategy

### 7.1 Unit (Vitest)

Every function in `src/core/` is pure and unit-tested. Coverage target: 95%+ for `verdict/`, `simulator/`, `schematic/`. Tests live next to source as `*.test.ts`. Worked examples from `design-report.md` §5.2.8 and §5.7 are baked in as test cases (regression protection — if the math drifts, those tests fail).

### 7.2 Integration (Vitest)

- Ingest pipeline run end-to-end against `tests/fixtures/sample-gh-export.xml`. Verifies parse → upsert produces the expected rows.
- Schema migration runs cleanly from scratch on an in-memory SQLite.
- Reference data import scripts produce stable JSON outputs.

### 7.3 E2E (Playwright + electron-playwright)

Three core flows tested:
1. **Cold start** — launch app, open settings, create a character, set profession priorities, add a schematic, see it in the active list.
2. **Refresh and triage** — click refresh, wait for ingest, see verdicts appear, keyboard-triage three resources.
3. **Simulator A-vs-B** — open simulator, configure variant A from inventory, save, swap a slot, save variant B, verify the delta panel shows the expected math.

### 7.4 Simulator validation (§7.6 of design — post-build)

Once Phase 6 ships, the validation harness (`scripts/validate-simulator.ts`):
1. Picks 5 schematics covering different ingredient counts and property-group shapes.
2. Logs predicted experimental property values for each.
3. Ryan crafts each in-game with the matching resources, records actual values.
4. Script compares predicted vs actual; tuning iteration until within ±2%.

This is a Phase 6+ activity, not blocking earlier phases.

---

## 8. Distribution

### 8.1 v1: single-user, sideload

`pnpm build` produces:
- Windows: `dist/GalaxyCrafter-<version>-Setup.exe` (NSIS installer via electron-builder)
- macOS: `dist/GalaxyCrafter-<version>.dmg`
- Linux: `dist/GalaxyCrafter-<version>.AppImage`

Distribution path: direct download from a GitHub Release (private repo for v1; public if shared with SR2 community later). No code signing for v1 — Windows SmartScreen warning is acceptable. macOS Gatekeeper warning likewise.

### 8.2 Auto-update — deferred

`electron-updater` can wire to GitHub Releases later. Not needed for single-user. Added when (if) the app gets shared.

### 8.3 Data location

User data lives in `app.getPath('userData')`:
- Windows: `%APPDATA%\galaxycrafter\`
- macOS: `~/Library/Application Support/galaxycrafter/`
- Linux: `~/.config/galaxycrafter/`

Contents:
```
db.sqlite                       # main database
snapshots-archive/              # compressed historical XMLs (90-day rolling)
log/                            # rolling app log
config-override.json            # user overrides for verdict thresholds, etc.
```

Backup is "copy the data folder." Restore is the reverse.

---

## 9. Open architectural questions

These aren't blocking — they get answered during the phases they're relevant to. Listed here for visibility.

### 9.1 GH rate-limiting

Does GH throttle export downloads? Likely not at 2/day per IP, but worth confirming during Phase 1 manual fetch. If they do throttle, we cache aggressively and back off; that's a tiny code change.

### 9.2 Schematic data source fallback

Phase 2 plan A is parsing Core3 Lua directly — it's the server's actual schematic data and what SR2 runs against. Plan B if Core3 Lua is partial or awkward to parse: hand-curated JSON for the ~30 schematics in Ryan's Weaponsmith / Artisan scope, augmented over time as new schematics enter focus. The GH daily XML export is resource-only and is not a schematic source; the schematic browser on GH is rendered from MySQL tables not exposed in the export.

### 9.3 Verdict recompute cost

Recomputing verdicts across 5,000 spawning resources × ~30 active schematics × ~3 characters × ~5 property groups per schematic = ~2.25M score computations. Each is trivial math. Estimated <1s on a modern laptop. Profile in Phase 3; if it's slow, cache per-(resource, schematic) intermediate scores keyed on resource stats hash.

### 9.4 Despawn-time estimation accuracy

Per-resource-type typical-lifetime data is fuzzy. v1 uses a rough estimate per resource group (e.g. minerals last ~7-21 days, organics ~3-14). If estimates are way off, we can refine using GH's historical data (`/exports/all<galaxyId>.xml`) to fit per-type lifetime distributions. Phase 5+ refinement.

### 9.5 Reference-data update model

`reference-data/*.json` ships bundled with the app version. If Core3 / SR2 adds new resource types or schematics, a new app release is needed to pick them up. For a solo-use app this is fine; if shared, consider an in-app "check for reference-data updates" pull from a GitHub raw URL. Defer.

### 9.6 Concurrency: writer vs reader

SQLite in WAL mode handles concurrent readers + one writer. The ingest pipeline is the only writer; the renderer is read-only (via IPC). No conflict expected. If we add user mutations (mark resource as ignored, etc.) and they coincide with an ingest, the mutation just queues. Note in Phase 1.

### 9.7 Telemetry

None v1. Solo-use; no need. If shared later, opt-in basic analytics (which features get used) might be valuable. Defer.

---

## 10. Quick start summary

Once §6 action items are done, Phase 1 looks like:

```bash
cd GalaxyCrafter/
pnpm init
pnpm add electron react react-dom react-router @types/react @types/react-dom \
         better-sqlite3 drizzle-orm drizzle-kit \
         fast-xml-parser undici node-cron \
         zustand \
         tailwindcss @tailwindcss/vite \
         vite @vitejs/plugin-react \
         electron-builder
pnpm add -D typescript @types/node @types/better-sqlite3 \
            vitest @playwright/test electron-playwright-helpers \
            @biomejs/biome

# generate skeleton
# (manual: create src/main/index.ts, src/preload/index.ts, src/renderer/main.tsx, etc.)

pnpm dev    # opens Electron window pointing at vite dev server
```

That's the end of Phase 1's setup work. Everything after that is feature code.

---

## Appendix A — Why Electron and not Tauri / Wails / native

Electron is heavier than Tauri (~150MB packaged vs ~10MB), but for a solo-use desktop tool the size is irrelevant and the trade-off pays in:
- Largest community + plugin ecosystem (debugging issues is google-able)
- Best Claude-pair-dev signal density (model knows Electron well)
- Mature electron-builder packaging
- Mature electron-updater for future auto-update
- Node 22 in main process = filesystem, SQLite, scheduler, HTTP all trivial

Tauri (Rust core + webview) would be lighter and arguably more 2026-feeling, but the Rust learning curve adds friction for a solo dev whose stated comfort is TypeScript + AI pair-dev. Defer to v2 if footprint ever becomes an issue.

## Appendix B — Why React and not SvelteKit / SolidJS

Mostly a pair-dev consideration: Claude generates higher-confidence React code than Svelte or Solid (training data density). For an app with ~20-30 components and one developer, ecosystem maturity + tooling > raw runtime performance. React 19's compiler closes most of the perf gap with Svelte / Solid for this scale.

If Ryan has independent reason to prefer Svelte, the rest of this plan adapts cleanly — only `src/renderer/` changes, the rest of the architecture is framework-agnostic.

---

## Sources cross-referenced

- `design-report.md` — companion design doc; this workplan implements its principles and features
- `~/workspace/Core3/MMOCoreORB/bin/scripts/managers/` — vanilla Core3 Lua data; source for resource caps and schematics (§6.2)
- `galaxyharvester.net/exports/current<galaxyId>.xml` — live SR2 spawn feed (§4 of design)
- `MEMORY.md` entries on Core3 location, build incantation, and the extraction-mod knowledge base — context for the §6 action items
