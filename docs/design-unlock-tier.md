# Design: UNLOCK tier — first-of-its-kind resource for tracked schematics

**Status:** advisor-reviewed 2026-05-13. Awaiting Ryan sign-off before workplan.

**Advisor pass — corrections folded back into this doc:**
1. Q2 flipped — despawned units do NOT count as covered for UNLOCK. Live + reserved only. ("It's a draining bucket, not a replenishing one.")
2. Q5 rationale now cites Ryan's exact words.
3. Q4 sub-component flow + inventory-mutation recompute trigger — both verified in code (see §Verification at bottom).

## The gap

The verdict engine today scores every spawning resource against the player's active-schematic property weights and tiers them CHASE / MAYBE / SKIP based on absolute quality (or delta-vs-owned for owned-inventory case).

What it doesn't capture: **slot-coverage urgency**. If a player tracks "Advanced Weapon Scope" but owns zero Chromium Aluminum, then **any** spawning Chromium Aluminum is high-priority — even a mediocre one — because without it, the craft is literally blocked. The current engine scores that mediocre chromium aluminum at ~30, calls it SKIP, and the player never sees it on the dashboard. Hours later they want to craft, can't, and have to scramble.

Ryan's framing: *"it should be a category, not chase, but need maybe, so i can easily find and build the stockpile, even if not great. until i have good ones."*

## The right semantic

A raw resource slot on an active schematic is **COVERED** iff the player owns ≥1 unit (status = `live` OR `reserved`) of at least one resource whose type fits the slot's `ingredientObject` (via the existing IFF/type-ancestor compat check). Otherwise it's **UNCOVERED**.

Despawned-only inventory does NOT count as covered. Despawned is a draining bucket — those units may already be earmarked, partially consumed by tests, or running out before the player gets back to that craft. The whole point of UNLOCK is "you can't replenish this." If the only thing keeping a slot covered is a despawned stash, UNLOCK should fire so the player grabs the new spawn while they can.

A spawning resource gets the **UNLOCK** flag iff it would cover at least one currently-uncovered slot on any active schematic.

UNLOCK is **orthogonal to quality** — a trash 30-score chromium aluminum is still UNLOCK if you own zero (live or reserved). A perfect 95-score chromium aluminum is BOTH UNLOCK and CHASE.

## Why this matters more than a bigger threshold tweak

Lowering the CHASE/MAYBE thresholds would surface MORE resources but wouldn't change the WHY. Partial-stat resources Ryan needs would still be ranked by quality alone, which misses the point — quality doesn't matter when zero is the alternative.

A separate UNLOCK flag carries semantic meaning the player can act on: "I have nothing here yet — grab anything that fits."

## Tier integration

Two options:

**Option A — Add UNLOCK as a fourth tier.**
- New order: CHASE > UNLOCK > MAYBE > SKIP
- Single primary tier per resource
- Pro: simple to display
- Con: a great chromium aluminum is both CHASE and UNLOCK; we'd have to pick one to surface

**Option B — Keep CHASE/MAYBE/SKIP, add UNLOCK as orthogonal flag.**
- Each resource has a quality tier (CHASE/MAYBE/SKIP) AND an UNLOCK boolean
- Display: badge stack — e.g. `[CHASE] [UNLOCK]` on a great-and-needed resource, `[SKIP] [UNLOCK]` on a trash-but-needed one
- For sort/priority in lists: UNLOCK trumps SKIP, but CHASE still trumps UNLOCK alone
- Pro: composable, doesn't lose info
- Con: slightly more visual complexity

**My recommendation: Option B.** UNLOCK is genuinely orthogonal — pretending it's a tier conflates "should I want this" with "is it a quality upgrade." The SB-flag lane already established the "orthogonal badge" pattern; UNLOCK fits there.

## Display priority

Default sort order across the app where mixed:
1. UNLOCK + CHASE (need + great quality — top priority, build that first)
2. UNLOCK alone (need-it-at-all-costs — stockpile build)
3. CHASE alone (upgrade quality on already-covered slots)
4. MAYBE (decent, on watch)
5. SB-flagged resources (market value, orthogonal to your craft list)
6. SKIP (everything else)

UNLOCK + SKIP outranks plain CHASE? Honestly yes for a new-character workflow, no for a stocked crafter. **Make this a Settings preference** with a sensible default. Or two preset modes ("new player" vs "established crafter").

For v1: hardcode order, defer the preference.

## Where it surfaces

### Resources tab
- New badge column or chip in resource rows: `UNLOCK` (yellow/amber)
- Filter chip: "Show UNLOCK only"
- Sort: optional `UNLOCK first` sort mode

### Resource detail page
- New section: "This resource UNLOCKS"
  - List of (schematic, slot, units required) tuples the resource would cover
  - Click-through to schematic detail
- Verdict box gets a second-row UNLOCK badge alongside the tier

### Dashboard
- New lane (or fold into existing): "Stockpile builders" or "Unlock these"
- Top N UNLOCK resources sorted by quality (best UNLOCK chromium first, then next)
- Compact card format

### Crafting plan panel (schematic detail)
- Already implicitly handles uncovered slots ("— none in inventory —" + CHASE flag for the spawn). But the spawn flag should explicitly say UNLOCK so the player understands the urgency.

### Schematic detail header
- Quick badge: "X of Y slots covered" (e.g. "3/5 slots covered — 2 unlocks needed")
- Drives the player to act when they add a schematic they're not ready to craft.

## Implementation surface

### Schema

Two storage options:

**a) Extend `verdicts` table** with a new boolean column `unlocks_any` + JSON column `unlocks_json` listing the schematic+slot pairs.
- Pro: one row per resource-character-snapshot, already exists, joins are simple
- Con: schema migration

**b) New table `unlock_flags(resourceId, snapshotId, characterId, schematicId, slotName)`** for the M:N mapping.
- Pro: cleaner data model, no JSON
- Con: more rows, more queries to roll up

**My pick: (a) extend verdicts.** Existing recompute pipeline runs per-character-per-snapshot anyway; this fits naturally. JSON column for the per-schematic breakdown is fine — it's read-only data downstream.

Migration: add `unlocks_any INTEGER` (boolean) + `unlocks_json TEXT` to `verdicts`. Default 0 / null. Backfill on next recompute (already implicit).

### Compute (recompute.ts)

After the existing per-(resource, schematic, propertyGroup) match loop, before persisting verdicts:

```ts
// Step 1: build slot-coverage map per active schematic.
// For each active schematic with raw slots, check if ANY inventory row
// (any status) has a typeId fitting that slot's ingredientObject.
const uncoveredSlots: Array<{schematicId, slotName, ingredientObject}> = [];
for each active schematic:
  for each raw slot (ingredientType === 0, skip optional 3/4):
    const covered = inventoryRows.some(inv =>
      resourceTypeFitsRawSlot(resourceById[inv.resourceId].typeId, slot.ingredientObject, typeAncestors)
    );
    if (!covered) uncoveredSlots.push({schematicId, slotName, ingredientObject});

// Step 2: for each candidate (= spawning resource), find which uncovered slots it would fill.
for each candidate resource:
  const unlocks = uncoveredSlots.filter(s =>
    resourceTypeFitsRawSlot(candidate.typeId, s.ingredientObject, typeAncestors)
  );
  if (unlocks.length > 0) {
    set verdict.unlocks_any = true
    set verdict.unlocks_json = JSON.stringify(unlocks)
  }
```

Performance: O(active_schematics × slots × inventory) + O(candidates × uncovered_slots). Bounded — maybe 5k+20k operations per recompute. Negligible.

### IPC

Extend the existing `verdicts:list` response shape:
- Add `unlocksAny: boolean` and `unlocks: Array<{schematicId, schematicName, slotName, ingredientObject, unitsRequired}>` to `VerdictEntry`
- Resource detail's `verdict` block similarly extended

### UI changes (in priority order)

1. **Resources tab** — UNLOCK badge in the existing row + a filter chip. Maybe ~30 LOC.
2. **Resource detail page** — "This resource UNLOCKS" section. ~50 LOC.
3. **Schematic detail header** — "X / Y slots covered" line. ~20 LOC.
4. **Crafting plan panel** — explicit UNLOCK label on uncovered-slot rows. ~10 LOC.
5. **Dashboard** — new lane or fold into existing. ~100 LOC.

## Open design questions

These are the points I'd most want the advisor to pressure-test:

### Q1: Does "covered" mean ≥ 1 unit, or some larger threshold?

If a player has 1 unit, they technically have it but can't actually craft an item that needs 24 units. Should we add a "STOCKPILE" tier for `0 < units < threshold`?

My instinct: **v1 = ≥1 unit counts as covered.** Adding STOCKPILE would require knowing per-schematic units required (we have that) AND tracking which schematic + how many crafts the player intends. Too many degrees of freedom for a first cut. Revisit after we see how UNLOCK alone performs.

### Q2: Do despawned-only inventory rows count as covered? — FLIPPED after advisor review

**Original instinct (wrong):** count despawned as covered, defer the replenishment case to a separate REORDER tier.

**Walked-through counter-example (advisor):** Player has 50 units of `iron_dolovite` despawned a week ago. Slot accepts the iron family. Under "all-statuses-cover", that slot is COVERED → UNLOCK off. A fresh `iron_anaxite` (same family) spawns. With UNLOCK off the dashboard doesn't flag it. Player misses the spawn. *That's exactly the scenario Ryan is trying to solve* — Ryan's framing is "build the stockpile, even if not great. until i have good ones" which is fundamentally about **ongoing supply**, not point-in-time inventory.

**v1 decision:** Live + reserved count as covered. Despawned does NOT. Folds the would-be REORDER case into UNLOCK naturally — no second flag needed.

Reserved is included because the player consciously earmarked those units; that's intent-tagging, not supply loss. They're not draining and they're not gone.

### Q3: Optional slots (ingredientType 3, 4)?

Optional slots (per Core3's `OPTIONALIDENTICALSLOT` / `OPTIONALMIXEDSLOT` enum) don't block the craft if empty. A missing optional slot doesn't mean "can't craft" — it means "can't get the bonus."

v1: **Skip optional slots from UNLOCK computation.** They're nice-to-have, not blockers. Could revisit with a `BONUS_UNLOCK` flavor later.

### Q4: Sub-component slots? — VERIFIED in code

A schematic's sub-component slot (ingredientType 1, 2) takes a crafted item, not a raw resource. The recursive question: does the sub-component itself have uncovered slots?

**Verification (advisor flagged this as load-bearing):** `src/main/ipc.ts:696-770` handles `schematics:addActive`. When called with `withSubcomponents=true`, it queries `schematicDependencies` for the schematic's child rows and inserts an `activeSchematics` entry per child with `source: 'inherited'` and `parentSchematicId` set. `buildActiveContext` in `recompute.ts:110-191` iterates **all** active rows regardless of source. Sub-component schematics' raw slots end up in the same per-character `activeCtx` collection that UNLOCK will iterate over. Confirmed.

v1: **UNLOCK computation runs on every active schematic's raw slots independently.** Sub-component schematics being on the active list means their raw slots are checked. The parent's sub-component slot itself isn't checked for UNLOCK (it's the sub-component's job to be craftable).

Edge: if Ryan adds a parent schematic with `withSubcomponents=false`, sub-component schematics won't be on the active list and their raw slots won't drive UNLOCK. That matches the user's explicit "don't track these" intent — not a bug.

### Q5: Display priority — UNLOCK vs CHASE rank?

When sorting a list with both UNLOCK and CHASE items, which goes first?

- "New player" view: UNLOCK first (build the foundation)
- "Established crafter" view: CHASE first (upgrade what works)

**v1 decision: UNLOCK + CHASE first, then UNLOCK alone, then CHASE alone, then MAYBE, then SKIP.**

Rationale — Ryan's verbatim framing locks the order: *"it doesn't matter if it sucks, it's my first and unlocks crafting that schematic, so it should be a category, not chase, but need maybe, so i can easily find and build the stockpile."* Quality is explicitly secondary when coverage is zero. UNLOCK-alone outranks CHASE-alone is not a guess; it's the instruction.

Could expose this as a Settings preset later. Mention in v0.x release notes that the ordering is opinionated and we may add a toggle.

### Q6: Naming

`UNLOCK` is my pick. Alternatives I considered:
- `NEED` — Ryan's word. Clear but reads like a verb command, not a state.
- `FIRST` — implies "first of its kind." Cute but ambiguous (first what?).
- `STOCKPILE` — wrong semantics; that's a separate concept for replenishing low stocks.
- `UNCOVERED` — accurate but negative-framed; "uncovered slot needs covering" is two words.
- `STARTER` — implies new-player-only, but established crafters get UNLOCK on schematics they newly add.

UNLOCK reads as "this resource unlocks something for me." Active, positive, accurate.

### Q7: Bulk-tier interactions

Currently the Dashboard's "Right Now" lane shows top CHASE resources. Should UNLOCK items appear here, or in a separate "Stockpile" lane?

Option A: Fold UNLOCK into "Right Now" — the lane becomes "top priority for crafting" which includes both CHASE quality and UNLOCK coverage.

Option B: Separate "Stockpile" / "Unlocks Needed" lane — keeps "Right Now" pure CHASE-quality, adds a dedicated lane.

v1 lean: Option B. Easier to communicate to the player. The dashboard already has lanes for verdict-driven content, SB-flagged content, inventory health. Adding "stockpile" reads as a natural expansion.

## What this is NOT

- Not a REORDER tier (despawned-only / running-low) — that's a separate concept.
- Not a STOCKPILE tier (unit-count below a threshold) — depth-deferred.
- Not a BONUS_UNLOCK tier for optional slots — out of scope v1.
- Not a SUB_UNLOCK tier for transitive sub-component needs — already implicit via active-list inheritance.

## Decision points needing Ryan's call

Before I code:

1. Confirm **Option B** (orthogonal flag, not a 4th tier).
2. Confirm **UNLOCK as the name** (or pick `NEED` — Ryan's word — or another alternative).
3. Confirm the v1 scope — flag only, no STOCKPILE / BONUS_UNLOCK / units-threshold variants. REORDER is folded into UNLOCK by the Q2 flip.
4. Confirm display priority order (UNLOCK+CHASE > UNLOCK > CHASE > MAYBE > SKIP).
5. Confirm dashboard surfacing: new lane vs fold-in.
6. **Confirm Q2 flip** — despawned does NOT count as covered, only live + reserved. (Advisor-surfaced; this changes whether despawned-stash players get UNLOCK pings when new spawns of the same family appear.)

## Verification log (code-confirmed, do not re-verify)

- **Sub-component inheritance** — `src/main/ipc.ts:696-770` (`schematics:addActive`) auto-inserts inherited rows; `recompute.ts:110-191` iterates them. Sub-component raw slots flow into UNLOCK correctly.
- **Recompute-on-inventory-change** — `src/main/ipc.ts:1236` (inventory:upsert) and `:1269` (inventory:remove) both call `recomputeForCharacter`. UNLOCK staleness is not a concern.
- **Inventory status enum** — `live | despawned | reserved` (per `src/shared/ipc-types.ts:222`). The Q2 cover-set is `live ∪ reserved`.
- **Owned-best-score code** — `recompute.ts:323-379` counts ALL statuses for `ownedBestScore` (quality comparison). That's correct for the existing CHASE/MAYBE delta math and stays unchanged. UNLOCK uses a *separate* filter.

## Workplan (v0.1.6)

**Phase 1 — Core math + storage**
1. Drizzle migration `0006_add_unlock_columns.sql` — adds `unlocks_any INTEGER` + `unlocks_json TEXT` to `verdicts`.
2. Update `src/db/schema.ts` verdicts table.
3. Update `src/main/verdict/recompute.ts`:
   - Build per-character "covered family set" from `live ∪ reserved` inventory only.
   - Per active schematic, derive `uncoveredSlots` (raw slots whose ingredient family isn't in the covered set).
   - In candidate loop, compute `unlocks: Array<{schematicId, schematicName, slotName, ingredientObject}>` per resource.
   - Write `unlocks_any` + `unlocks_json` to verdict row.
   - **Forced-row insert**: when `unlocks.length > 0` but rollup returns null (resource only SKIP-tier-matches), still write a row with `tier='SKIP'` and `unlocks_any=1`. Surface checks use `unlocks_any` independent of tier.
4. Unit tests in `src/core/verdict/score.test.ts` (or new `unlock.test.ts`): live covers / despawned doesn't / reserved covers / zero fires / inheritance / SKIP-with-UNLOCK row.

**Phase 2 — IPC + types**
1. Extend `VerdictEntry` in `src/shared/ipc-types.ts` with `unlocksAny: boolean` + `unlocks: Array<{schematicId, schematicName, slotName}>`.
2. Extend `ResourceDetail.verdict` with same fields.
3. Update `verdicts:list` handler and `resources:detail` handler in `src/main/ipc.ts` to read/parse new columns.
4. Add a `schematicId` → "X/Y slots covered" derived value to the schematic detail response.

**Phase 3 — UI surfaces (priority order)**
1. **Resources tab** — UNLOCK badge in resource row + "Show UNLOCK only" filter chip. (~30 LOC)
2. **Resource detail** — "This resource UNLOCKS" section listing schematic/slot tuples. (~50 LOC)
3. **Schematic detail header** — "X/Y slots covered" pill. (~20 LOC)
4. **Crafting plan panel** — explicit UNLOCK label when slot row is uncovered. (~10 LOC)
5. **Dashboard** — new "Unlocks needed" lane below "Right Now". (~100 LOC)

**Phase 4 — Release**
1. Bump `package.json` to 0.1.6.
2. `pnpm test` — all green (98 + new unlock tests).
3. Release notes draft.
4. Commit, push, build installer, GitHub release. Auto-updater takes it from there.
