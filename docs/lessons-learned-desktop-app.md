# Lessons Learned — Building & Shipping GalaxyCrafter

A retrospective on the tech stack, architecture, and packaging path that took GalaxyCrafter from `pnpm init` to a public Windows installer on GitHub Releases. Written 2026-05-13 after v0.1.3 shipped. Designed to be carried verbatim into the next desktop-app project.

## TL;DR

The stack that worked: **Electron 33 + electron-vite + React 19 + Tailwind v4 + TypeScript + better-sqlite3 + Drizzle ORM + Vitest + Biome + pnpm 11**. Packaged with **electron-builder**, auto-updated via **electron-updater**, hosted on **GitHub Releases** (free, no signing, no servers). Dev loop is one `pnpm dev` command, releases are one `pnpm build:win:nopublish` + a 4-file `gh release create`.

The gotchas that ate hours: **Windows MAX_PATH on pnpm's `.pnpm/<hash>/` directories**, **electron-builder `files:` overriding defaults instead of extending**, **pnpm building native modules against the wrong Node ABI**, and **silent crashes on first launch with zombie processes**. All four are fixed once and forgotten — captured in the relevant sections below so you don't relearn them.

---

## 1. Stack choices and why

### Electron 33

- The platform choice for a cross-platform desktop app written in JS/TS. Heavy at runtime (~150 MB packaged), but the only way to ship Node + Chromium + native modules in one binary that users double-click. For a tool whose UI is a SPA and whose backend is local SQLite + HTTP fetches, the weight is the price of admission.
- The version (33) tracked the current stable when we started. Newer versions exist — re-evaluate per project. **Pin the version in `package.json` and let Dependabot / a manual quarterly review bump it.** Native modules (better-sqlite3) are tied to Electron's Node ABI, so bumping Electron mid-development is real work.

### electron-vite as the build orchestrator

- electron-vite wraps Vite for all three Electron processes (main, preload, renderer) with one config file. Hot-reload works in the renderer; main and preload changes still need a manual restart of the dev session — that's the only annoyance.
- The `defineConfig({ main, preload, renderer })` shape is the convention. Each process gets its own Vite build with its own aliases. Keep them separated by what they need access to: main + preload import from `@shared`, renderer imports from `@shared` + `@core` (pure-math code). Renderer should never import from `@main`.

### React 19 + React Router DOM 7

- Standard SPA stack. Router uses hash routing (`createHashRouter`) because Electron loads the renderer via `file://` and pathname routing doesn't survive a refresh in that environment.
- TypeScript strict mode. The IPC contract types in `src/shared/ipc-types.ts` are consumed by all three processes — the contract is enforced by the compiler, so adding an IPC handler is a 4-file change (main handler, preload bridge, types, renderer caller) but you can't get out of sync.

### Tailwind v4

- Used `@tailwindcss/vite` plugin. No `tailwind.config.js` — v4 is config-in-CSS. Imports look like `@import "tailwindcss";` in your root CSS file.
- Dark theme hardcoded throughout via `slate-*` classes. **If you want light mode, plan for it on day one.** Retrofitting is a per-component slog because there's no theme variable layer separating "background" from "slate-900."

### better-sqlite3 + Drizzle ORM

- **better-sqlite3 over node-sqlite3 / sql.js / IndexedDB.** Synchronous API (great for a local SQLite — no callback hell), WAL mode by default, fast. Ships as a precompiled `.node` native binding per platform per Node ABI.
- **Drizzle over raw SQL / Prisma.** Schema-as-TypeScript in `src/db/schema.ts`. Migrations generated via `pnpm db:generate` (Drizzle Kit), checked into `drizzle/migrations/`. Applied at app startup via `drizzle.migrate()` against the user's local DB.
- **DB location:** `app.getPath("userData")` which is `%APPDATA%\<app-name>\<dbname>.sqlite` on Windows. **Survives uninstall/reinstall, which is exactly what you want.** Reference data (resource types, schematics) bundled as JSON files and loaded at startup via hash-comparison "skip reload if unchanged" logic.

### fast-xml-parser

- For ingesting GalaxyHarvester XML feeds. Default settings worked. The library is fast, well-maintained, and dependency-light.

### Biome (instead of ESLint + Prettier)

- Single binary, single config. ~10x faster than ESLint. Worth migrating from ESLint if you're starting fresh. Default config is sensible.

### Vitest

- Test runner. Reuses Vite's transform pipeline so test execution is fast (~1s for our 95 tests). Worth the buy-in for any Vite project.

### pnpm 11

- Disk-efficient, content-addressable. Required some workarounds on Windows (see §4). On Linux/Mac, smooth sailing. **For solo desktop-app projects on Windows, npm or yarn might be less drama** — see §4. We made pnpm work, but it cost a half-day of debugging.

---

## 2. Architectural patterns that paid off

### Three-layer code separation

```
src/
├── core/           Pure TS, no DB / no Electron APIs. Math, scoring,
│                   algorithms. Renderer-importable so you can show
│                   inline computed previews. ~95 unit tests live here.
├── main/           Electron main process. DB access via Drizzle,
│                   IPC handlers, ingest pipeline orchestration.
├── preload/        Tiny contextBridge surface — every IPC the renderer
│                   can call. One bridge per IPC, no surprises.
├── renderer/       React UI. Imports from @shared (types) + @core
│                   (math). Never imports from @main.
├── ingest/         Data fetch + parse (XML, etc.). Lives in main's
│                   import graph but separated for clarity.
├── db/             Drizzle schema + migrations + reference-data loader.
└── shared/         IPC contract types. Imported by all three processes.
```

**The win:** unit-testable pure-math core. The verdict engine, planner allocator, simulator math — all of it runs in Vitest with no Electron, no DB mocks, no fixtures beyond the type-checked stubs. Caught a doc typo (a sample value was wrong in our `crafting-math.md`) on the first test run. Caught real edge cases in the planner allocator (bucket diversity overflow, dedup-by-resource-id) before they hit the UI.

### IPC contract as a single TypeScript interface

```ts
// src/shared/ipc-types.ts
export interface IpcApi {
  refreshSnapshot(): Promise<RefreshResult>;
  listResources(snapshotId?: string): Promise<Resource[]>;
  // ... ~40 methods
  onSnapshotIngestComplete(listener: (e: SnapshotIngestEvent) => void): () => void;
}
```

Main implements via `ipcMain.handle("snapshot:refresh", async (_evt, ...) => ...)`. Preload bridges via `ipcRenderer.invoke("snapshot:refresh", ...)`. Renderer calls `window.api.refreshSnapshot()`. **Adding an IPC method is a 4-line diff across three files and the compiler tells you if you forgot any.** This pattern saved us from drift dozens of times.

### Reference data as bundled JSON + hash-compare loader

```ts
// src/db/reference-loader.ts
const raw = readFileSync(filePath, "utf8");
const hash = sha256(raw);
if (!isStale("schematics", hash)) {
  console.log("[ref] schematics up to date — skipping reload");
  return;
}
// ... parse + insert
markLoaded("schematics", hash, parsed.schematics.length);
```

Reference data (schematics, resource types, harvester catalogue, experimental ranges) ships as JSON inside the asar. The loader runs at startup, hashes each file, and only re-inserts when the bundled content changes (i.e. when the user installs a new version with updated data). This means app startup is fast on every launch after the first — no redundant 1700-row inserts.

### Verdict / Recompute orchestration

Mutations that affect the verdict engine (snapshot refresh, schematics added to active list, character profession change, threshold edit) call `recomputeForCharacter(id)` synchronously in the same IPC handler, then broadcast `verdicts:updated` to all renderer windows. Renderer routes that show verdict-derived UI subscribe and refetch. Pattern is "implicit recompute" — no manual "recompute now" IPC the renderer has to call.

### Per-feature small commits

Every feature got its own commit with a long-form message explaining what + why + tradeoffs. **Made bisecting the v0.1.0 crash trivial** — we went from "the installer crashes on launch" to root cause in 20 minutes by reading recent commit messages. Don't underestimate the value of writing the commit message for the future you who's debugging at 2am.

---

## 3. Distribution path that worked

### Packaging: electron-builder

- Configured via `electron-builder.yml` at the project root. The whole config is ~50 lines. Key fields:
  - `appId` (reverse DNS — `com.htownag.galaxycrafter`)
  - `productName` (display name — `GalaxyCrafter`)
  - `files` (what goes in the asar — **see §4 gotcha #2**)
  - `asarUnpack` (native bindings that can't run from inside the asar — better-sqlite3, bindings, etc.)
  - `win.target` (we ship `nsis` installer + `zip` portable)
  - `nsis.*` (oneClick=false, perMachine=false, shortcuts, etc.)
  - `publish` (provider=github + owner/repo)
- Run via `pnpm build:win:nopublish` which is `electron-vite build && electron-builder --win --x64 --publish=never`. Outputs four files to `dist/`:
  - `GalaxyCrafter-Setup-X.Y.Z.exe` (NSIS installer, ~86 MB)
  - `GalaxyCrafter-X.Y.Z-x64.zip` (portable, ~117 MB — slightly larger because not compressed by NSIS)
  - `GalaxyCrafter-Setup-X.Y.Z.exe.blockmap` (auto-updater diff manifest)
  - `latest.yml` (auto-updater latest-version pointer)

### Hosting: GitHub Releases

- Free. No CDN to set up. No domain to maintain. `gh release create vX.Y.Z file1 file2 ... --notes-file notes.md` ships in 30 seconds.
- Auto-updater (electron-updater) reads `latest.yml` from the GitHub Release tagged `vX.Y.Z` and verifies via `.blockmap`. **No additional infrastructure.** The release page also serves as the download page for new users.
- Release notes in markdown. We wrote them as a user-facing announcement (what changed, how to install, gotchas) — not as a changelog. Saved versions to a notes file each release for consistency.

### Auto-update: electron-updater

- ~50 LOC of glue in `src/main/updater.ts`. Wires `app.isPackaged`-guarded event listeners on the autoUpdater singleton. Skipped entirely in dev.
- **Silent on failure** — every error is logged but never surfaces to the user. Failed checks retry on next launch. The only UI it produces is the positive "ready to install" toast.
- **Two-state UI** — toast appears at "download complete," not at "checking" or "downloading." User isn't surprised mid-launch.
- Manual `Check for updates` button in Settings for testing + power-user transparency.

### Public repo + MIT

- Repo flipped public when v0.1.0 was ready to publish. Added `LICENSE` (MIT — boilerplate from electron's own license style), updated README for end users (install instructions, first-run walkthrough), kept the dev workflow section.
- **The repo doubles as your distribution page.** Releases tab is the download page. README is the intro. No separate website needed for v0.x.

---

## 4. Gotchas that bit us (write these down)

### Gotcha #1: Windows MAX_PATH + pnpm's `.pnpm/<hash>/` deep paths

**Symptom:** electron-builder's NSIS step aborts with `!include: could not open file: ...` where the path is ~260+ characters. The file actually exists but Windows file APIs can't open it.

**Cause:** pnpm's content-addressable store creates directories like `node_modules/.pnpm/app-builder-lib@25.1.8_dmg-_1bb375569cbd8d6bc505988dd6df2f0f/node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh`. Combined with a moderately deep project path (we were in a git worktree, ~95 chars), total path length blows past Windows' 260-char `MAX_PATH` limit. NSIS's 32-bit `makensis.exe` doesn't handle long paths.

**Fix:** Build from a short root path like `C:\dev\appname\` instead of from your dev tree if it's deep. We also added `node-linker=hoisted` + `shamefully-hoist=true` + `dedupe-peer-dependents=false` to `.npmrc` to shorten things as much as pnpm allows, but the short build path is the only reliable fix.

**Permanent fix:** Enable Windows long-path support via registry (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`, reboot). Requires admin. Skip this if you can just keep your project path short.

### Gotcha #2: electron-builder `files:` overrides defaults, doesn't extend

**Symptom:** Packaged app crashes silently on launch — `require('better-sqlite3')` fails with module-not-found. No window appears. Helper processes (GPU, utility) spawn and zombie.

**Cause:** electron-builder's default `files` list includes `**/*` (everything except known cruft). The moment you specify your own `files` array, you're REPLACING the defaults, not adding to them. We had:
```yaml
files:
  - out/**
  - package.json
  - reference-data/**
  - drizzle/migrations/**
```
…which dropped `node_modules/**` entirely. Production deps never made it into the asar.

**Fix:** Add `node_modules/**` explicitly to your `files` list, plus the usual exclusions for docs / tests / sourcemaps. Or don't specify `files` at all if you don't need filtering.

### Gotcha #3: pnpm builds native modules against the wrong Node ABI

**Symptom:** Packaged app crashes with `Error: The module '...better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 130.`

**Cause:** pnpm builds native modules during `pnpm install` against the **system Node** (whatever's in your PATH). Electron 33 ships its own Node fork with a different ABI. The `.node` binding compiled for system Node won't load in Electron.

**Fix:** Set `npmRebuild: true` in `electron-builder.yml`. electron-builder will invoke `@electron/rebuild` during packaging to recompile native deps against Electron's ABI. **Don't disable this** — I disabled it thinking pnpm had it covered, and the resulting v0.1.0 was the broken release that needed the v0.1.1 hotfix.

### Gotcha #4: pnpm 11's `onlyBuiltDependencies` needs both halves

**Symptom:** Every build command errors with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: <package>@<version>`. Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.

**Cause:** pnpm 11 added a security feature blocking install/postinstall scripts on dependencies that aren't explicitly approved. The approval lives in TWO places now (changed mid-pnpm-10):
- `package.json#pnpm.onlyBuiltDependencies` — the original allowlist
- `pnpm-workspace.yaml#allowBuilds` — the newer per-package boolean

**Fix:** Set both. For our native deps:
```yaml
# pnpm-workspace.yaml
onlyBuiltDependencies:
  - '@biomejs/biome'
  - better-sqlite3
  - electron
  - esbuild
allowBuilds:
  '@biomejs/biome': true
  better-sqlite3: true
  electron: true
  esbuild: true
```
Plus `verify-deps-before-run=false` in `.npmrc` so subsequent `pnpm <script>` invocations don't re-error on the dep-status check.

### Gotcha #5: Silent crashes are hard to debug — `--enable-logging` is your friend

**Symptom:** Packaged app launches, you see 3-4 `<AppName>.exe` processes in Task Manager, but no window. Quit them via Task Manager and they won't die without admin (Access Denied).

**Cause:** Main process throws during init (before BrowserWindow is created). Helper processes (utility, GPU) spawn before the throw and zombie because their parent main died ungracefully. Without admin you can't kill them.

**Fix workflow:** Launch the packaged exe from PowerShell or CMD with `--enable-logging --v=1`:
```powershell
& "C:\path\to\App.exe" --enable-logging --v=1 2>&1 | Out-File errors.log
```
This forces Chromium's logging to stderr, which captures uncaught exceptions from main. Read the log to find the actual error.

If you can't kill zombies: reboot. Don't waste time fighting Task Manager.

### Gotcha #6: SQLite WAL mode + zombie processes can corrupt data

**Symptom:** Pre-existing DB has user data, you launch the new (broken) version, it crashes, you launch a working version — and user tables are empty.

**Cause:** The broken app opened a SQLite connection that started a read transaction. The connection process zombied (couldn't be killed). The zombie's snapshot held the WAL from advancing past its read point. When the working version came along and ran its own writes, WAL state got tangled up and on the next clean shutdown the user data wasn't preserved through the WAL checkpoint.

**Fix:** Reboot before doing anything else. Then if you have a backup, restore from it. Don't try to copy DB files while zombies are running — they might still hold handles.

**Prevention:** **Make a safety backup of `app.getPath('userData')` BEFORE any first-test of a packaged build against existing dev data.** A `Copy-Item -Recurse $userData $desktop\backup-$timestamp` is 10 seconds and saves your bacon.

### Gotcha #7: Code signing — skip it, document the SmartScreen click-through

**Symptom:** First-time users see "Windows protected your PC" SmartScreen warning. They have to click "More info" → "Run anyway."

**Cause:** Windows defaults to blocking unsigned executables from the internet.

**Options:**
- **Skip signing.** Free. Document the click-through in your install instructions. Acceptable for a community tool with <1000 installs/year.
- **EV cert** (~$500/yr from DigiCert / SSL.com). Skips SmartScreen entirely after building reputation. The only path if you need polish.
- **Self-signed cert.** Doesn't help SmartScreen. Skip.

We chose to skip signing for v0.1.0+ and revisit if community adoption demanded it.

### Gotcha #8: Reference data sources can surprise you

**Symptom:** You assume your data source has field X. You build the feature around it. Field X turns out to not exist.

**Real example:** I assumed the GalaxyHarvester schematic JSON had `experimentalMin` / `experimentalMax` for each property. It didn't — those live in the SR2 server's Lua template files for the produced item, not the draft schematic. Required writing a one-time Node script (`scripts/extract-experimental-ranges.mjs`) that walks the Lua files, parses with regex, and emits JSON we bundle separately.

**Prevention:** Verify the data shape EARLY. Write the extractor before you build the feature. If you can't, you're going to find out the shape doesn't match while you're three layers deep in scoring logic.

---

## 5. Workflow that scaled

### Dev loop

- `pnpm dev` — opens Electron window with hot-reload for renderer changes. Main / preload changes need `Ctrl+C` → `pnpm dev` again. This is annoying but worth knowing.
- `pnpm test` — runs Vitest. ~1s for 95 tests.
- `pnpm build` — pure JS build (no electron-builder). Useful for "does TypeScript compile?" sanity check.
- `pnpm build:win:nopublish` — full Windows packaging. Outputs to `dist/`.
- `pnpm db:generate` — Drizzle migration generator. Run after every schema edit.

### Release loop

For each release:

1. Bump version in `package.json` (semver).
2. Commit + push to remote (and subtree-split + push to public repo if you have a worktree setup).
3. `pnpm build:win:nopublish` from a short build path (`C:\dev\<app>\`).
4. Smoke-test the packaged exe — launch from `dist\win-unpacked\<app>.exe`, verify window appears, verify data loads.
5. Write release notes in markdown (user-facing, not changelog).
6. `gh release create vX.Y.Z dist/<installer>.exe dist/<portable>.zip dist/<...>.blockmap dist/latest.yml --notes-file notes.md`.
7. Done. Users with auto-update get the new version on their next launch.

For solo dev, this is ~10 minutes per release.

### File-layout snapshot

```
.npmrc                      pnpm flags (hoisted, shamefully-hoist, etc.)
pnpm-workspace.yaml         build approvals
package.json                deps, scripts, version
electron.vite.config.ts     electron-vite config (main/preload/renderer)
electron-builder.yml        packaging config (asar files, NSIS, publish)
LICENSE                     MIT
README.md                   end-user install + dev quick start
src/
  main/                     Electron main process
  preload/                  contextBridge surface
  renderer/                 React UI
  core/                     pure-math TS, unit-testable
  ingest/                   external data fetch + parse
  db/                       Drizzle schema + migrations + ref-data loader
  shared/                   IPC types
drizzle/migrations/         checked-in SQL migrations
reference-data/             bundled JSON (resource types, etc.)
scripts/                    one-off extractors (incl. SR2 IFF data)
docs/                       design docs, lessons learned, open items
```

---

## 6. What I'd do differently next time

1. **Build from a short path on day one.** Don't fight Windows MAX_PATH in production. `C:\dev\<app>\` from the start. Symlink to your worktree if needed.

2. **Set up GitHub Actions for build-on-tag from week 1.** It's ~2 hours to wire up and turns your local "build + release" into "git tag vX.Y.Z && git push --tags". Skip the dance of building on your own laptop every time.

3. **Pin native module versions explicitly.** better-sqlite3 + Electron's Node ABI is a tight coupling. Document which versions go together. Add a build-time assertion that fails if `NODE_MODULE_VERSION` doesn't match expected.

4. **Add `--enable-logging` instructions to the README.** When someone reports "it doesn't launch," you'll need them to run with logging. Have it written down.

5. **Plan light mode (or theme variables) on day one.** Retrofitting Tailwind dark-only code to support light mode is a per-component slog. Use CSS custom properties (or shadcn/ui's variable approach) for `bg-background`, `text-foreground`, etc. Worth the small upfront tax.

6. **Backup userData before every first-install test against existing data.** Cheap insurance. Cost me real time when I didn't.

7. **Write the release notes as you commit, not at release time.** Each feature commit gets a one-line "user-facing summary" in the body. Release notes are then a `git log --grep="^\* "` away. Saves the "what did I do this week" panic at release time.

8. **Don't disable `npmRebuild`.** Just leave it on. If pnpm-install builds work for dev, that's great; if they don't match Electron's ABI, electron-builder will fix it during packaging. Belt + suspenders.

9. **Drizzle migrations: never DROP, always ALTER.** When you change a column type or rename a table, write the migration as a two-step (add new + backfill + drop old) so existing-user data survives. Test migrations against a real existing DB before tagging the release.

10. **Set up `gh release` and `electron-updater` BEFORE the first public release.** Don't wait for v0.2.0 to add auto-update — the v0.1.0 → v0.1.1 manual install dance burned a real user's data in our case. Auto-update from day one keeps everyone on the latest fix.

---

## 7. Stuff you can copy verbatim

If you're starting a new desktop-app project, these are the files / configs that were dialed in by the time we shipped. Open them in this repo and lift:

- **`electron-builder.yml`** — Windows installer + portable zip + GitHub publish provider. Just change `appId`, `productName`, `publish.owner`, `publish.repo`.
- **`electron.vite.config.ts`** — main / preload / renderer with TypeScript aliases. Same structure works for any Electron + React project.
- **`.npmrc`** — pnpm 11 flags that avoid the path-length + build-approval pain.
- **`pnpm-workspace.yaml`** — build-approval allowlist for native deps.
- **`src/main/updater.ts`** — electron-updater wiring with the "fail-quiet, toast on download-complete" UX.
- **`src/db/reference-loader.ts`** — hash-compare reload pattern for bundled JSON data.
- **`src/shared/ipc-types.ts`** — three-process IPC contract pattern.
- **`src/renderer/src/App.tsx`** — toast pattern (single rendered toast at a time, auto-dismiss for informational, action-required for material).
- **`scripts/extract-*.mjs`** — one-off data extractors. The "write a Node script, bundle the JSON output, version it" pattern beats live data-source fetching for anything that doesn't change per-user.

---

## 8. Cheat sheet for the next solo project

| Step | Command / file |
|------|------|
| Init | `pnpm create @quick-start/electron` (then strip what you don't need) |
| Add UI | `pnpm add react react-dom react-router-dom @vitejs/plugin-react` |
| Add Tailwind v4 | `pnpm add tailwindcss @tailwindcss/vite` |
| Add DB | `pnpm add better-sqlite3 drizzle-orm`; `pnpm add -D drizzle-kit @types/better-sqlite3` |
| Add tests | `pnpm add -D vitest` |
| Add lint/format | `pnpm add -D @biomejs/biome` |
| Add packaging | `pnpm add -D electron-builder` |
| Add auto-update | `pnpm add electron-updater` |
| Approve builds | `pnpm-workspace.yaml` → `onlyBuiltDependencies` + `allowBuilds` |
| Set npm config | `.npmrc` → `node-linker=hoisted`, `shamefully-hoist=true`, `dedupe-peer-dependents=false`, `verify-deps-before-run=false` |
| Configure packaging | `electron-builder.yml` → `appId`, `productName`, `files: [out/**, package.json, node_modules/**, ...]`, `asarUnpack: ["node_modules/<native-pkgs>/**"]`, `npmRebuild: true`, `win.target: [nsis, zip]`, `publish: {provider: github, owner, repo}` |
| Make repo public + add MIT | `gh repo edit --visibility public`; copy `LICENSE` from a permissive Electron repo |
| Build short-path | `robocopy <project> C:\dev\<app> /MIR /XD node_modules`; `cd C:\dev\<app>`; `pnpm install`; `pnpm build:win:nopublish` |
| Release | `gh release create vX.Y.Z dist/*.exe dist/*.zip dist/*.blockmap dist/latest.yml --notes-file notes.md` |

That's the whole pipeline. From scratch to first installer on GitHub is a focused weekend.
