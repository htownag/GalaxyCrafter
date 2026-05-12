# Open Items — Near-Term Build Queue

Lightweight tracker for items that aren't on a phase plan but need to land soon. Each item gets one bullet of "what" and one of "why now." When an item lands, **delete it from this file in the same commit as the implementation** (the git log preserves provenance).

---

## Up next

_None pending — pick from the deferred list below or open a new entry._

---

## Deferred (on the design, not yet built, not scratched)

These items survive from the original `design-report.md` after the major lifts (Dashboard, Planner, Verdict + SB engines, Crates, Resource Finder, Schematic Library, Dependency Tree, Settings) all shipped. None are urgent. Pull from here when revisiting the app for a quality-of-life pass.

### New-player mode — beyond the planner (§5.8 Steps 1, 2, 4, 5)

- **What.** The planner covers Step 3 (harvester allocation). The design originally outlined a full 5-step new-player workflow:
  1. **Confirm professions** — onboarding wizard that walks a fresh character through priority selection.
  2. **What to chase right now** — guided new-player-shaped list of top spawning resources with planet + waypoint + concentration hints.
  3. **Harvester allocation** — DONE (Phase 7 planner).
  4. **Survey route** — ordered list of resource-survey targets per chosen planet; tickbox-driven.
  5. **Exit criteria** — auto-detect when the player crosses N+ resources stocked + at least one running harvester, flip the UI back to standard mode.
- **Why deferred.** The planner already gives a useful answer for a new player without all 5 steps. The full guided workflow is nice-to-have rather than blocking.

### Settings — theme override

- **What.** Light-mode option. Currently the entire app is dark-only with hardcoded slate-* classes.
- **Why deferred.** Real implementation means restyling every component. Settings page has a placeholder under "Coming later" pointing at this.

### Settings — cards vs rows toggle (§6.2)

- **What.** Per-page view preference: every list view (Resources / Schematics / Inventory / Finder / SB lane / etc.) gets a toggle between dense rows and richer cards.
- **Why deferred.** A meaningful but tasteful refactor across every list component. Punted to a focused UX pass.

### Settings — snapshot cadence (§5.14)

- **What.** Background timer that auto-refreshes the GH snapshot every N hours. Currently only manual refresh on the Resources tab.
- **Why deferred.** Needs scheduler infrastructure in the main process; not hard, but not justified until a player actually asks for it.

### Keyboard triage (§6.6)

- **What.** J/K vertical navigation through resource / schematic / inventory lists. Hotkeys for common actions ("a" to add to active, "i" to add to inventory, etc.).
- **Why deferred.** Pure polish for power users. Mouse + click works fine for the core flows.

### Crafting simulator (§5.7) — shelved, not deleted

- **What.** Full simulator was shipped end-to-end (v1 → v1.3) then **shelved 2026-05-11 pending UX rework**. Math core (95 tests), IPC handlers, UI route, experimental-range data (1.1 MB JSON for 1660 schematics), migration 0005, and the extraction script all remain in the tree.
- **Why deferred.** Per Ryan: "not happy with this simulator tab, can we shelve it for now? Save what we did but turn it off on the app?" The percentage-of-cap output didn't read as useful; the predicted-final-stats panel improved it but Ryan still wasn't satisfied with the UX. Re-enable by uncommenting 2 lines in `src/renderer/src/App.tsx` + the import/route in `src/renderer/src/main.tsx`.

### Looted-component catalog

- **What.** Reference-data file listing the known SR2 exotic loot components (Rancor Tooth, Nightsister Vibro Motor, Advanced Scope, Krayt Dragon Tissue, etc.) with their IFF derivation, which slot lineages they substitute into, and their attribute hints (`dotType`, `dotStrength`, ...).
- **Why deferred.** Today the dep tree flags optional slots as "OPTIONAL" but doesn't enumerate what fills them. Player uses their in-game knowledge. The catalog unlocks two features cleanly: (a) showing alternative loot fills in the dep tree alongside crafted producers, and (b) simulating loot DOT contributions if/when the simulator is unshelved.
- **Why now-ish.** Light data work (the SR2 patch-K comment in `~/workspace/srswgemu2/MMOCoreORB/src/server/zone/objects/player/sessions/crafting/CraftingSessionImplementation.cpp` enumerates the patch-K-aware loots; community wiki has the rest).

### Concentration data ingest (GH waypoint reports)

- **What.** GH's bulk `current<galaxyId>.xml` feed doesn't ship per-planet concentration. To get real concentration data we'd need to ingest GH's separate waypoint-report endpoint and store per-(resource, planet) concentration rows.
- **Why deferred.** Both the harvester planner and the (shelved) simulator originally specced concentration-aware scoring. The planner shipped without it (predicted yields are 100%-concentration ceilings); a real value here would tighten its recommendations meaningfully.

---

## How to use this file

- New entries: append to "Up next" (or a new dated section if scope grows).
- When implementing: read the bullet, do the work, delete the bullet in the implementation commit.
- "Deferred" entries can sit here long-term — they're a parking lot for design items not currently being worked.
