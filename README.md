# GalaxyCrafter

A personal-aware crafting + resource planner for **Star Wars Galaxies Emulator** servers — built first for [Sentinels Republic 2](https://swgsentinels.com/), retargetable to any galaxy tracked by [galaxyharvester.net](https://galaxyharvester.net).

**What it does.** Pulls your server's resource snapshot from GH, scores every spawning resource against your active schematic list + inventory + profession priorities, surfaces the ones actually worth chasing right now ("CHASE"), the ones worth keeping an eye on ("MAYBE"), and the ones that are server-best for any of the 8 crafting professions even if you don't need them yourself. Plus a harvester planner for new characters with 10 lots, a recursive dependency graph so you can see what a T21 actually needs from raw materials up, and per-resource owned-vs-spawning comparisons.

**What it isn't.** A bot, an auto-clicker, a server. It reads public GH XML, stores nothing on a backend, makes no game-server calls. 100% local SQLite database in your `%APPDATA%`.

---

## Install (end users)

Head to the [Releases page](https://github.com/htownag/GalaxyCrafter/releases) and grab the latest:

- **`GalaxyCrafter-Setup-X.Y.Z.exe`** — standard Windows installer. Goes in `Program Files`, creates a Start Menu shortcut, supports clean uninstall via "Apps & Features." Recommended for most users.
- **`GalaxyCrafter-X.Y.Z-portable.zip`** — unzip-and-run, no install, no admin needed. Good for thumb drives or testing.

> **First-run SmartScreen warning.** Windows will pop "Windows protected your PC" the first time you run an unsigned app from the internet. Click **More info** → **Run anyway**. The app isn't signed (cost) — this is a known click-through for community-built tools.

**First time using the app:**

1. Create a character on the Character tab. Pick your profession priorities (primary / secondary / ignored) — these drive every scoring decision the app makes.
2. Browse the Schematics tab and add the recipes you actually craft to your Active list. Sub-components inherit automatically; advanced variants are preferred where available.
3. Go to Resources → Refresh to pull the current SR2 snapshot from GalaxyHarvester. Verdicts compute automatically; the Dashboard fills in.
4. (Optional) Add resources you have in-game on the Crates tab. The verdict engine flips to delta-vs-owned scoring once you have inventory, so it'll only surface upgrades over what you already hold.

Data lives at `%APPDATA%\galaxycrafter\galaxycrafter.sqlite`. Backup or move that file to migrate setups; the Settings tab also has a JSON export for safer interchange.

---

## Quick start (dev)

```powershell
pnpm install
pnpm dev
```

Opens an Electron window with hot reload on the renderer side. Main / preload changes need a manual restart (`Ctrl+C` → `pnpm dev` again).

## Build a Windows installer

```powershell
pnpm build:win:nopublish
```

Outputs to `dist/`:
- `GalaxyCrafter-Setup-X.Y.Z.exe` — NSIS installer
- `GalaxyCrafter-X.Y.Z-x64.zip` — portable zip
- `latest.yml` — auto-update manifest (consumed by future electron-updater integration)

> **Path-length gotcha on Windows.** electron-builder's NSIS step calls a 32-bit `makensis.exe` that aborts when an include path exceeds Windows' 260-char `MAX_PATH` limit. pnpm's `.pnpm/<pkg>@<ver>_<peer-hash>/` directory structure can easily push transitive deps over that limit. If you see `!include: could not open file: ...` during the build, clone or copy the project to a short root path (e.g. `C:\dev\GalaxyCrafter`) and build from there. The repo's `.npmrc` already opts into hoisted + shamefully-hoist layouts to shorten things as much as pnpm allows; the rest is just choosing a shallow checkout location.

## Documents

- `design-report.md` — what GalaxyCrafter is (features, principles, killer differentiators)
- `docs/crafting-math.md` — Core3 crafting formulas pulled from source (referenced by the shelved simulator)
- `docs/new-player-planner.md` — Phase 7 planner design
- `docs/open-items.md` — deferred / "later" tracking
- `logbook/` — dated session notes

## Folder layout

```
src/
├── main/        Electron main process (Node-land: DB, ingest, IPC)
├── preload/     contextBridge for renderer
├── renderer/    React UI
├── core/        pure TS — verdict engine, simulator math, planner
├── ingest/      GH XML pipeline
├── db/          SQLite + Drizzle schema + migrations
└── shared/      types shared across processes
reference-data/  bundled JSON (resource types, schematics, harvesters, etc.)
scripts/        one-off data-import scripts (incl. SR2 IFF extractors)
```

## Stack

Electron 33 · React 19 · Vite 6 · TypeScript · Tailwind v4 · better-sqlite3 · Drizzle ORM · fast-xml-parser · Biome · Vitest · electron-vite · electron-builder.

## License

MIT. See [`LICENSE`](LICENSE).

## Acknowledgements

- [GalaxyHarvester](https://galaxyharvester.net) for the public XML API every SWGEmu resource tool builds on, and for ten years of running it.
- [SWGEmu](https://swgemu.com) + the Core3 team for the open-source server that makes this entire ecosystem possible.
- [Sentinels Republic 2](https://swgsentinels.com/) staff for the live galaxy this is built against.
