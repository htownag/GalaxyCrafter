# Phase 7 — New-Player Harvester Planner

**Status:** planning. Drafted 2026-05-11. Implementation lands after Ryan signs off on the framing.

> **What this is.** A single-page recommendation engine: "you have 10 lot slots, here's the highest-value 10 harvesters to drop right now." The output is concrete: harvester size + resource class + which spawning resource + which planet, in priority order. Aimed at a new player who's just installed GalaxyCrafter and needs an actionable starting point.

> **What this is NOT.** Long-horizon optimization, despawn-aware scheduling, multi-character allocation, factory-ready stockpile planning. Each of those is a follow-up if we want it; v1 is the "next 10 harvesters" answer only.

---

## 1. Inputs

The planner runs in the context of an **active character** (existing UI flow). From the character it pulls:

- **Profession priorities** (primary / secondary / ignored from `profession_priorities`). Drives which resources matter.
- **Active schematic list** (`active_schematics`). Refines "which stats matter" beyond profession defaults. Optional — a brand-new player has none, in which case the planner falls back to the profession's top-line schematics.
- **Galaxy** (from character record). Pins which snapshot's resources we score against.
- **Inventory** (`inventory_entries` with `status='live'`). The planner should not re-recommend a resource you're already actively harvesting (would be redundant); if a resource is on-hand at `status='despawned'` we still recommend it if it's currently spawning under a different name.

User-supplied inputs on the planner page itself:

- **Lots available for harvesters** (0..10, default 10). The hard cap is always 10 — that's the SWG lot rule. The player drops this when they've used some lots for a house, factory, or vendor; the planner respects whatever they enter. No need for an "already deployed" subtractor — the field IS the available-for-harvesters number.
- **Planet bias** (optional). Drop-down: "any" / pick a specific planet. Lets players who've committed to a home planet bias toward it.

**No credit budget input.** Structure costs vary by server (and by patch) and we have no reliable way to know SR2's current numbers — Ryan called that explicitly. The planner ignores credit cost; player makes the size choice based on their own wallet awareness.

## 2. Harvester model

SWG harvester types in 2 dimensions: **size** (personal / medium / heavy) and **resource class** (mineral / chemical / flora / water / gas / radioactive / wind / solar). Ryan's stated v1 scope collapses those classes to three buckets:

| Bucket | Covers | Why grouped |
|--------|--------|-------------|
| **Mineral** | metals, ores, gemstones, radioactive | Solid harvester variants — "mineral" in vendor parlance |
| **Chemical** | chemical, petrochemical, polymer, lubricating oil, fiberplast | Solid harvester variants — "chemical" in vendor parlance |
| **Energy** | wind, solar | The two energy harvester archetypes — flora-fuel and water are excluded from v1 (rarely competitive for a new player's 10 lots) |

If the player asks "what about water / flora?" the answer is "out of scope for v1; v1 of the planner is the 80% case, not exhaustive coverage."

Each (size, bucket) combination has approximate stats — Core3 values are server-tunable, so we'll ship SR2's published numbers and document the source. Only **BER** drives the v1 scoring; hopper is shown to the player as informational; cost/maintenance are excluded from v1 per the no-credit-budget decision. Rough table to be confirmed against SR2's `harvester.lua` data:

| Size | BER | Hopper | Lots |
|------|----:|-------:|-----:|
| Personal mineral/chemical | 8  | 30000 | 1 |
| Personal energy           | 6  | 30000 | 1 |
| Medium mineral/chemical   | 12 | 45000 | 1 |
| Medium energy             | 8  | 45000 | 1 |
| Heavy mineral/chemical    | 16 | 60000 | 1 |
| Heavy energy              | 11 | 60000 | 1 |

**Source-of-truth target:** rather than hardcode in TypeScript, ship a `reference-data/harvesters.json` file with provenance metadata, mirroring how `schematics.json` and `galaxies.json` are loaded. The JSON keeps the full stat set (BER + hopper + cost + maintenance) for forward compatibility; v1 only reads BER + hopper.

## 3. Scoring model

For each (resource, planet) pair currently spawning that fits one of the three buckets above, score the **harvester-deployment value**:

```
deploymentValue(resource, planet, size) =
    resourceScore(resource)              // 0..100, from verdict engine
    × ber(size, resource.bucket)               // 5..15 per table above
    × hoursPerDay                              // = 24
```

**Concentration is intentionally absent.** GH's bulk `current<id>.xml` feed (our ingest source) does not publish per-planet concentration — only the resource's planet list. Concentration data lives in GH's separate waypoint-report endpoint, which we don't currently ingest. The planner reports a ceiling daily yield (`BER × 24`) and the player calibrates downward based on their own survey readings. Adding real concentration is a Phase 7.5 feature.

Then the optimization target is `sum(deploymentValue)` across the chosen lots, subject to lot count.

**resourceScore is profession-weighted:** the planner uses the existing verdict engine's `score` field. If a resource is `SKIP` for the player's profession, `resourceScore = 0` and it won't be picked. If it's `TOP_CHASE` for the primary profession, it's the highest scorer.

**Optional: SB lane mixing.** A player might want to pick up valuable resources their schematics don't need but the broader market values (e.g. an Architect spotting a TOP_for_Weaponsmith spawn that'll resell well). Add a "Include market-value flagged resources" toggle (default off in v1; design doc §5.2.7's spirit). When on, blend `resourceScore = max(personalScore, sbScore × 0.5)` — half-weight so personal still wins on ties.

## 4. Algorithm — greedy fill with bucket diversity bias

```
candidates = all (resource, planet, size, bucket) tuples spawning right now
            where resource fits the bucket's resource group
            AND resource.score (verdict.score) > 0
            (no concentration filter — see §3)

sorted = candidates sorted desc by deploymentValue

selected = []
lotsRemaining = lotsAvailable     // from input, 0..10
bucketCount = { mineral: 0, chemical: 0, energy: 0 }

for c in sorted:
  if lotsRemaining <= 0: break
  if c.resourceId in selected.resourceIds: continue  // dedup
  // Bucket diversity: cap any single bucket at ceil(lotsAvailable × 0.6)
  // unless the player explicitly disables diversity. Prevents the greedy
  // from filling 10/10 with mineral just because mineral scores best on
  // this snapshot.
  if bucketCount[c.bucket] >= ceil(lotsAvailable × 0.6) && diversityOn: continue

  selected.push(c)
  lotsRemaining -= 1
  bucketCount[c.bucket] += 1

return selected
```

**Why greedy not LP:** the problem is small (budget × candidates ~ 10 × 200 ~ 2000 considerations) and the objective is approximately separable. Greedy gives a result within a few percent of optimal in nearly all cases, runs <10ms, and is debuggable. We can swap to a true bin-pack solver in v1.1 if a real case shows greedy choosing badly.

**Why bucket diversity:** a new player who hits "give me 10 lots" and gets back 10 mineral harvesters is going to be confused — most professions need at least some chemical or energy. The 60% cap (i.e. max 6 of one bucket on a 10-lot budget) is a soft heuristic that yields recognisably balanced output without forcing 33/33/33 splits when one bucket genuinely dominates.

## 5. UI — single route `Planner.tsx`

Layout: two-pane.

**Left — inputs + summary.**
- "Lots available for harvesters" number input (0..10, default 10)
- Planet bias dropdown (default "any")
- Diversity toggle (default on)
- "Include market-value flagged resources" toggle (default off)
- Profession context summary (read-only): "Primary: Architect, Secondary: Weaponsmith — drives scoring"
- Plan recomputes on input change (250ms debounce so the page feels live; no manual "Run" button)
- Plan summary card: "N harvesters · projected score-weighted yield = X · bucket split M/C/E"

**Right — recommendation list.**
- Ordered table, rank 1..N.
- Columns: rank, size badge (P/M/H), bucket icon, resource name (clickable to ResourceDetail), planet, concentration%, score, est daily yield.
- Each row has an inline "Already deployed?" toggle that marks the candidate as deployed locally (state-only, doesn't write to DB in v1; nice tweaking surface).
- Bottom of table: "Show next 10" for players who want to plan a second wave.

**Header callout:** a small grey-text note: "Recommendations refresh on resource snapshot fetch. Run Resources → Refresh to update."

## 6. IPC + storage

One new IPC handler: `planner:recommend(input)` → `PlannerResult`.

Types:
```ts
interface PlannerInput {
  characterId: string;
  lotsAvailable: number;     // 0..10, default 10
  planetBias?: string;       // 'any' or planet name
  diversity: boolean;
  includeSbLane: boolean;
}

interface PlannerRecommendation {
  rank: number;
  resourceId: string;
  resourceName: string;
  bucket: 'mineral' | 'chemical' | 'energy';
  size: 'personal' | 'medium' | 'heavy';
  planet: string;
  concentration: number;          // 0..100
  resourceScore: number;          // 0..100, verdict.score
  deploymentValue: number;        // raw score, internal
  estDailyYield: number;          // BER × conc × 24
}

interface PlannerResult {
  recommendations: PlannerRecommendation[];
  summary: {
    lotsUsed: number;
    totalProjectedScore: number;
    bucketBreakdown: Record<'mineral'|'chemical'|'energy', number>;
  };
  fallbackMode?: 'no-active-schematics';  // populated when scoring leaned on SB lane because active list is empty
}
```

**No new tables in v1.** The planner reads from `resources`, `resource_observations`, `resource_planets`, `verdicts`, `sb_flags`, `profession_priorities`. Output is ephemeral (recompute on each call). If we later want to remember "I deployed these 8 last week" we can add an `harvester_deployments` table.

**Performance:** ~700 candidate resources × ~3 planets each × 3 buckets × 3 sizes = ~6000 tuples to score. Trivial.

## 7. Reference data shape — `reference-data/harvesters.json`

```jsonc
{
  "provenance": { "sourceCommit": "sr2-base-harvester-stats", "fetchedAt": "..." },
  "harvesters": [
    {
      "id": "personal_mineral",
      "size": "personal",
      "bucket": "mineral",
      "ber": 8,
      "hopper": 30000,
      "costCredits": 5000,
      "maintenancePerHour": 5,
      "lots": 1
    },
    // ...8 more rows
  ]
}
```

Loaded at startup like `schematics.json` and `resource-types.json`. SR2's published stats are the source; provenance metadata tracks where they came from so a future fork can diff.

## 8. Open questions — RESOLVED 2026-05-11

- **Concentration → dropped from v1 entirely.** Originally specced with a `conc > 50` floor and `× conc/100` weighting in the scoring formula. Then I caught (and Ryan confirmed) that GH's bulk feed doesn't ship per-planet concentration at all — the `resource_planets` table just stores `(resource_id, planet)` pairs. Pulling concentration would require ingesting GH's waypoint-report endpoint, which is Phase 7.5+ work. v1 ships without it: est-daily-yield is the ceiling (`BER × 24`), player mentally discounts for their own surveyed conc.
- **Energy bucket → one bucket.** Wind + solar collapsed. Locked.
- **Resource-shift awareness → punt.** No despawn signal in v1.
- **Maintenance / power → skip.** No credit modeling at all in v1 (servers vary too much; no reliable source for SR2's current numbers).
- **Player has no active schematics yet → two-track answer.**
  - **UI nudge:** if active schematic count = 0, render a callout at the top of the recommendation list: "You have no active schematics. The planner is using **current chase resources** for your profession. [Add schematics →]" (link to /schematics).
  - **Scoring fallback:** when active list is empty, score by SB flag × profession-priority weight only (the SB lane already encodes "what's currently TOP/NEAR across the bundled schematic library for profession X"). Result populates `PlannerResult.fallbackMode = 'no-active-schematics'` so the UI can surface the callout.

## 9. Out of scope (intentionally)

- Despawn-aware re-planning
- Multi-character lot allocation
- Crate-target stockpile sizing (Phase 6 simulator territory)
- Harvester admin / placement automation
- Vendor / decoration cosmetic costs
- House-storage-aware suggestions ("you've banked 50k iron_axidite, don't redeploy a heavy mineral on it")

## 10. Implementation order

1. Draft + commit `reference-data/harvesters.json` with SR2 stats. **Confirm numbers with Ryan first.**
2. Add `harvesters` table or in-memory cache + a loader hook (mirrors `loadSchematics` / `loadResourceTypes`).
3. Implement `src/core/planner/` pure-math core: `score.ts` (deployment value), `allocate.ts` (greedy fill with diversity).
4. Unit tests against `src/core/planner/` covering: empty active list fallback, credit-cap respected, diversity cap respected, planet-bias filter.
5. Wire `planner:recommend` IPC handler.
6. Build `Planner.tsx` route + nav link.
7. Smoke test on Ryan's SR2 snapshot.
