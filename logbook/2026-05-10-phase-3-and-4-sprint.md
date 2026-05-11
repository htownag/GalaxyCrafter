# 2026-05-10 — Phase 3 + Phase 4 weekend sprint

## Headline

Killer feature #1 — the personal-aware verdict engine — is **fully shipped end-to-end**, including the inventory layer that powers its real delta-vs-owned formula. Eight commits, ~3000 LOC, all visually verified against Mauryll's real SR2 snapshot.

## Phase ledger

| Commit    | Phase  | Summary |
|-----------|--------|---------|
| `7b7a478` | 3      | Verdict engine v1 — scoring + groups + minimal UI + 26 unit tests + migration 0002 |
| `6904e38` | 3 tune | CHASE 90→85, MAYBE 70→65 after first in-app distribution eval |
| `5abe39c` | 3B     | Resource Detail page — stats panel, verdict breakdown, fits-active table |
| `f50384a` | 4A     | Inventory schema + CRUD IPC plumbing + migration 0003 |
| `e547013` | 4B     | Crates UI route — autocomplete add + inline edit + remove |
| `6493b84` | 4C     | Delta-vs-owned scoring (the killer-feature payoff) + dichotomy logic |
| `31a033b` | 4D     | Owned tag + filter chips + breakdown delta/tier columns |

## Verdict engine — final state

Per design doc §5.2.5 with one advisor-mandated deviation. The formula is a **dichotomy on `scoreOwned`**:

- `scoreOwned == 0`: Phase 3 absolute thresholds (85/65). Preserves empty-inventory baseline as the regression contract.
- `scoreOwned > 0`: §5.2.5 delta path with thresholds CHASE delta ≥ 8, CHASE if score ≥ 90 AND delta ≥ 3, MAYBE delta ≥ 3, MAYBE if score ≥ 85.

The advisor caught my partial-floor proposal as broken (rules 2 and 3 also flood on empty inventory). The dichotomy is the cleaner contract — switching from empty-inventory to "you have one entry of compatible type" is a clean before/after the user can validate.

Profession-priority gating from §5.2.5 ("AND profession in priority_set") is intentionally not implemented as a separate gate: the active schematic list is the curated priority list, so scoring against it does the filter implicitly. Locked-in interpretation.

## Real-world numbers (Mauryll, T21 Rifle + sub-components, SR2 snapshot 484 spawns)

- **Empty inventory baseline (Phase 3):** 1 CHASE / 12 MAYBE → tuned to 2 CHASE / 12 MAYBE at 85/65.
- **After loading 7 inventory entries (Phase 4C):** 0 CHASE / 2 MAYBE / 484 scored, 300 owned-seeded matches in 21ms.

Delta math correctly tightened the radar from "12 MAYBE" to "2 MAYBE" by removing candidates whose owned alternatives are competitive. Recompute stays under 25ms even with full inventory walk × full active context.

## UI inventory

- **Resources route:** verdict column with CHASE/MAYBE pills + OWNED cyan tag (supersedes verdict pill on inventory rows); filter chip row above the table; sortable by verdict tier (CHASE > MAYBE > OWNED > none); search by name/type/group/planet; per-stat value cells colour-graded by percent-of-cap.
- **Resource detail (`/resources/:id`):** 11-stat percent-of-range bars; "In your Crates" cyan panel when owned; verdict breakdown table with Score/Owned/Δ/Tier per (schematic, property group) row; "Fits these active schematics" section independent of verdict tier.
- **Crates route (`/inventory`):** add-by-snapshot-autocomplete; inline edit units/status/notes; per-row save + remove; at-a-glance counts (live/banked/reserved).

## Data layer

- 4 migrations applied at startup: 0000 snapshots/resources, 0001 reference data, 0002 verdict + resource groups (7388 type-group ancestor edges + 99 groups), 0003 inventory.
- Reference data refreshed once (resource-types.json + schematics.json carry 99 group taxonomy + 7388 type-ancestor edges from `groups.csv` + `typegroup.csv`).
- Implicit recompute fires on: snapshot refresh, character create, active schematic add/remove, inventory upsert/remove. Renderer subscribes to `verdicts:updated`.

## Advisor moments worth re-reading

1. **Slot-fit data audit before write.** Confirmed `ingredientObject` is a group ID (or specific type) and that `weightTotal == Σweights` for T21 mindamage; avoided an hour of test-driven blundering on bad assumptions.
2. **Dichotomy on `scoreOwned`.** Caught my flawed partial-floor: rules 2 and 3 of §5.2.5 also flood on empty inventory. The two-mode dichotomy is the right contract and gives a clean regression baseline.
3. **Delete-predicate scoping.** `eq(verdicts.characterId, ...)` was nuking verdicts across all snapshots; advisor flagged this as a latent bug for the future historical-verdict feature. Fixed before any pushed commit.
4. **Threshold tune via in-app eval.** ABI mismatch blocked the standalone `threshold-eval.ts` script (better-sqlite3 built for Electron, not Node). Pivoted to in-app inspection via the recompute log line — gave us 1C/12M → tuned to 2C/12M in one round.

## Carry-forwards (Phase 5+)

- **`sb_flags` table is empty.** Server-best tagging across professions (§5.2.7) is a self-contained 3-4 hour piece that surfaces an orthogonal dashboard lane. Independent of personal craft list.
- **Profession-tier gating in scoring.** Currently no distinction between primary/secondary/ignored — active list scoping handles "user cares" implicitly. Phase 5+ could introduce the §5.2.6 secondary-downgrade rule.
- **Resource Detail deferred fields.** No image (GH thumbnail fetch), no despawn timer (need `typical_lifetime` per type), no concentration map (waypoint data not in our XML parse), no resource-finder reverse search.
- **Profession-priority data is collected but not consumed** — Character creation captures it; the verdict engine doesn't read it (per advisor: active-list scoping is enough).
- **Manufacturing-schematic-bake protection / simulator (Phase 6)** untouched. Will need the Core3 actual crafting-math audit before starting.
- **Pre-Phase-4 persisted breakdowns** lack `scoreOwned`/`tier` fields. Renderer treats undefined as 0/SKIP for graceful rendering; the next mutation-triggered recompute writes the new shape. Lazy migration, no schema bump needed.
- **Electron-vite quirk** confirmed: main-process changes don't auto-restart Electron. Manual `Get-Process electron | Stop-Process -Force` cycle is the workaround. Documented in memory.

## Next session

Phase 5 = Resource Finder (design doc §5.6). Schematic-driven reverse search: pick a schematic, see top-scoring spawns ranked against its property groups. Already have all the data; needs a new route + IPC. Probably 3-4 hours. Then SB flags (3-4 hours) for the orthogonal dashboard lane.

Phase 6 simulator deserves its own design pass before starting; not appropriate to commence on a late-Sunday push.
