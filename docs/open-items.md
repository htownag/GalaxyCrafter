# Open Items — Near-Term Build Queue

Lightweight tracker for items that aren't on a phase plan but need to land soon. Each item gets one bullet of "what" and one of "why now." When an item lands, **delete it from this file in the same commit as the implementation** (the git log preserves provenance).

---

## Up next (after Phase 6 plan edit, before Phase 7 new-player planner)

### 1. Advanced sub-component default on schematic add (CAPTURED 2026-05-11)

- **What.** When the user adds a schematic to their active list and that schematic has sub-component slots that accept both a base variant and an Advanced variant (e.g. `sword_core` vs `advanced_sword_core`), the inheritance pass should pick the Advanced variant by default.
- **Why now.** Active-list inheritance currently picks whichever variant the schematic's slot resolves to first. For Weaponsmith / Armorsmith schematics this surfaces the base sub-component, and users have to mentally swap to Advanced — same downstream resource-quality math but a strictly better recipe. Default should match what a competent player would actually pick.
- **Where to look.** `src/renderer/src/routes/ActiveSchematics.tsx` (the add flow) and the schematic-inheritance helper that resolves sub-component slots. Likely a small "if slot.acceptsVariants and an `advanced_` prefixed sibling exists, prefer that" guard.
- **Test target.** Add T21 carbine to active list → sub-component slots fill with advanced variants (advanced flechette barrel, etc.) where available.

### 2. Character page — edit chosen professions (CAPTURED 2026-05-11)

- **What.** Character page currently lets you create a character with a primary profession + (optional) secondary; no UI to change those after creation. Add inline-editable profession fields on the character detail page.
- **Why now.** Verdict + SB scoring is profession-driven. As we get closer to shipping the new-player planner and crafting simulator, "I picked Architect by mistake, I'm actually a Weaponsmith" needs to be a 2-click fix, not a wipe-and-recreate. Originally on the deferred-features list; the Phase 7 / Phase 6 timeline bumps it forward.
- **Where to look.** `src/renderer/src/routes/Character.tsx` (profession display); IPC handler that updates the `characters` table (likely `character:update` if it exists, otherwise add it). The `profession_priorities` table is what backs the dropdown ordering.
- **Test target.** Open existing character → change primary profession from "Architect" to "Weaponsmith" → save → verdict engine and SB flags re-render against new profession context without an app restart.

---

## How to use this file

- New entries: append to "Up next" (or a new dated section if scope grows).
- When implementing: read the bullet, do the work, delete the bullet in the implementation commit.
- This is intentionally not a long-running tracker. If something sits here >2 weeks, it's either bigger than a "quick item" (promote to a phase plan) or stale (delete).
