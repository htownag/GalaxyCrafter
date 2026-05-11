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

- **Lot budget** (default 10). Some players will have a different cap if they're not new — slider 1..20.
- **Already-deployed harvesters** (lots in use). Subtract from budget. Default 0.
- **Credit budget** (optional). If set, the greedy fill respects it; if blank, ignore credit cost in optimization.
- **Planet bias** (optional). Drop-down: "any" / pick a specific planet. Lets players who've committed to a home planet bias toward it.

## 2. Harvester model

SWG harvester types in 2 dimensions: **size** (personal / medium / heavy) and **resource class** (mineral / chemical / flora / water / gas / radioactive / wind / solar). Ryan's stated v1 scope collapses those classes to three buckets:

| Bucket | Covers | Why grouped |
|--------|--------|-------------|
| **Mineral** | metals, ores, gemstones, radioactive | Solid harvester variants — "mineral" in vendor parlance |
| **Chemical** | chemical, petrochemical, polymer, lubricating oil, fiberplast | Solid harvester variants — "chemical" in vendor parlance |
| **Energy** | wind, solar | The two energy harvester archetypes — flora-fuel and water are excluded from v1 (rarely competitive for a new player's 10 lots) |

If the player asks "what about water / flora?" the answer is "out of scope for v1; v1 of the planner is the 80% case, not exhaustive coverage."

Each (size, bucket) combination has approximate stats — Core3 values are server-tunable, so we'll hardcode SR2's published numbers and document the source. Rough table to be confirmed against SR2's `harvester.lua` data:

| Size | BER | Hopper | Cost (credits) | Maintenance/hr | Lots |
|------|----:|-------:|---------------:|---------------:|-----:|
| Personal mineral/chemical | 8  | 30000 | ~5000  | ~5  | 1 |
| Personal energy           | 6  | 30000 | ~5000  | ~5  | 1 |
| Medium mineral/chemical   | 12 | 45000 | ~50000 | ~10 | 1 |
| Medium energy             | 8  | 45000 | ~50000 | ~10 | 1 |
| Heavy mineral/chemical    | 16 | 60000 | ~150000| ~20 | 1 |
| Heavy energy              | 11 | 60000 | ~150000| ~20 | 1 |

**Source-of-truth target:** rather than hardcode in TypeScript, ship a `reference-data/harvesters.json` file with provenance metadata, mirroring how `schematics.json` and `galaxies.json` are loaded. Lets the player override / fork the numbers if their server's tuning differs.

## 3. Scoring model

For each (resource, planet) pair currently spawning that fits one of the three buckets above, score the **harvester-deployment value**:

```
deploymentValue(resource, planet, size) =
    resourceScore(resource)              // 0..100, from verdict engine
    × concentration(resource, planet) / 100   // 0..1, GH-reported
    × ber(size, resource.bucket)               // 6..16 per table above
    × hoursPerDay                              // = 24
```

Reads as **expected score-weighted units of useful resource per day on that lot**. Then the optimization target is `sum(deploymentValue)` across the chosen lots, subject to lot count + (optional) credit budget.

**resourceScore is profession-weighted:** the planner uses the existing verdict engine's `score` field. If a resource is `SKIP` for the player's profession, `resourceScore = 0` and it won't be picked. If it's `TOP_CHASE` for the primary profession, it's the highest scorer.

**Optional: SB lane mixing.** A player might want to pick up valuable resources their schematics don't need but the broader market values (e.g. an Architect spotting a TOP_for_Weaponsmith spawn that'll resell well). Add a "Include market-value flagged resources" toggle (default off in v1; design doc §5.2.7's spirit). When on, blend `resourceScore = max(personalScore, sbScore × 0.5)` — half-weight so personal still wins on ties.

## 4. Algorithm — greedy fill with bucket diversity bias

```
candidates = all (resource, planet, size, bucket) tuples spawning right now
            where resource fits the bucket's resource group
            AND resource.score (verdict.score) > 0
            AND concentration(resource, planet) > 50  (configurable floor)

sorted = candidates sorted desc by deploymentValue

selected = []
lotsRemaining = budget
creditsRemaining = creditBudget ?? ∞
bucketCount = { mineral: 0, chemical: 0, energy: 0 }

for c in sorted:
  if lotsRemaining <= 0: break
  if c.cost > creditsRemaining: continue
  if c.resourceId in selected.resourceIds: continue  // dedup
  // Bucket diversity: cap any single bucket at ceil(budget × 0.6) unless
  // the player explicitly disables diversity (some specialists want
  // all-mineral). Prevents the greedy from filling 10/10 with mineral
  // just because mineral scores best on this snapshot.
  if bucketCount[c.bucket] >= ceil(budget × 0.6) && diversityOn: continue

  selected.push(c)
  lotsRemaining -= 1
  creditsRemaining -= c.cost
  bucketCount[c.bucket] += 1

return selected
```

**Why greedy not LP:** the problem is small (budget × candidates ~ 10 × 200 ~ 2000 considerations) and the objective is approximately separable. Greedy gives a result within a few percent of optimal in nearly all cases, runs <10ms, and is debuggable. We can swap to a true bin-pack solver in v1.1 if a real case shows greedy choosing badly.

**Why bucket diversity:** a new player who hits "give me 10 lots" and gets back 10 mineral harvesters is going to be confused — most professions need at least some chemical or energy. The 60% cap (i.e. max 6 of one bucket on a 10-lot budget) is a soft heuristic that yields recognisably balanced output without forcing 33/33/33 splits when one bucket genuinely dominates.

## 5. UI — single route `Planner.tsx`

Layout: two-pane.

**Left — inputs + summary.**
- Lot budget slider (1..20, default 10)
- Already-deployed input (default 0)
- Credit budget input (optional, blank = no constraint)
- Planet bias dropdown (default "any")
- Diversity toggle (default on)
- "Include market-value flagged resources" toggle (default off)
- Profession context summary (read-only): "Primary: Architect, Secondary: Weaponsmith — drives scoring"
- "Run plan" button (recomputes on input change with 250ms debounce so the page feels live)
- Plan summary card: "10 harvesters · ~520k credits · projected score-weighted yield = X"

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
  lotBudget: number;
  alreadyDeployed: number;
  creditBudget?: number;
  planetBias?: string;     // 'any' or planet name
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
  costCredits: number;
}

interface PlannerResult {
  recommendations: PlannerRecommendation[];
  summary: {
    lotsUsed: number;
    totalCostCredits: number;
    totalProjectedScore: number;
    bucketBreakdown: Record<'mineral'|'chemical'|'energy', number>;
  };
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

## 8. Open questions

- **Concentration floor.** §4 uses `concentration > 50` as a hard floor. Real SWG harvesters extract from anything > 0 (just slowly). For a new-player planner, 50 is the right threshold; for an experienced player on a tight planet, maybe lower. Punt to v1.1 as a slider.
- **"Energy" bucket coverage.** Wind + solar split is real (wind on Talus, solar on Tatooine, etc.). Treat as one bucket for v1; if recommendation results feel weird we revisit.
- **Resource-shift awareness.** A resource that's about to despawn in 6 hours isn't a great pick. We don't currently store despawn-prediction confidence. Punt; ship without it.
- **Maintenance / power.** A heavy harvester costs ~20 credits/hour maintenance. Should the credit budget include that as a projected monthly drain? Probably yes — bake a "ongoing cost per day" into the summary card so the player sees `~520k upfront + ~480/day maintenance`.
- **Player has no schematics yet.** Verdict engine returns mostly 0-score in that case. Fallback: when active schematic count = 0, score by SB flag × profession-priority weight only. Otherwise the planner is empty for brand-new players, defeating the purpose.

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
