# Crafting Math — Pre-Phase-6 Audit

**Status:** research / planning. Drafted 2026-05-11 from a direct read of Core3's `MMOCoreORB/src/server/zone/managers/crafting/` and `MMOCoreORB/src/server/zone/objects/player/sessions/crafting/`. The simulator (Phase 6) must match these formulas; this doc is the canonical reference the implementation cites.

> **Source-citation convention.** `Core3:<path>:<line>` refers to `~/workspace/Core3/MMOCoreORB/src/server/zone/...`. All formulas below are pulled verbatim or paraphrased from Core3's master branch as of read-date 2026-05-11; verify any literal constants against the linked file before locking unit tests on them.
>
> **Verified-against-source constants (2026-05-11):**
> - Assembly tier enum (§2): `AMAZINGSUCCESS=0 … CRITICALFAILURE=8`, all 9 values — confirmed against `CraftingManager.idl:37-45`.
> - `assemblyPoints × 5` (§2) — confirmed against `SharedLabratory.cpp:187`.
> - `experimentingPoints × 4` (§5b) — confirmed against `CraftingManagerImplementation.cpp:111`.
> - Stat index → attribute mapping (§3) — confirmed against `ResourceSpawnImplementation.cpp:43` + `CraftingManager.idl:26-35`.
> - `calculateAssemblyValueModifier` table (§4) — confirmed against `SharedLabratory.cpp:59`.
> - `calculateExperimentationValueModifier` table (§5c) — confirmed against `SharedLabratory.cpp:21`.

---

## 1. The crafting flow (3 stages)

Per `CraftingSessionImplementation`:

1. **Stage 1 — slot fill.** Player puts resources / components into the schematic's ingredient slots. No math fires yet.
2. **Stage 2 — assembly.** Player clicks "Assemble." Game rolls `calculateAssemblySuccess`. Roll yields a **tier** from `BARELYSUCCESSFUL` to `AMAZINGSUCCESS`. Tier modulates initial property percentages via `setInitialCraftingValues`. After this point the resources are "spent" — you can't change slots.
3. **Stage 3 — experimentation.** Player has N experimentation points (skill-derived). Each "experiment" press rolls `calculateExperimentationSuccess` (yielding a tier) and applies `calculateExperimentationValueModifier(tier, points)` to the experimented row's current percentage. Cap = `maxPercent` (resource-derived ceiling).
4. **Finalisation.** Player chooses: (a) **Practice**, which discards the prototype and refunds nothing; (b) **Create Prototype**, which produces 1 finished item (durability-bound, decays); or (c) **Create Manufacturing Schematic**, which persists the prototype's `craftingValues` to a manufacture schematic in the player's datapad. The man schem is the **irreversible commit point** — factories produce identical items from it, and the values can't be edited. Phase 6's job is to give the player a high-confidence preview *before* this commit.

Each profession has its own labratory subclass:
- `ResourceLabratory` — weapons, armor, structures, food, clothing, generic. The "normal" crafting flow.
- `DroidLabratory` — droid engineer special path.
- `GeneticLabratory` — bio-engineer special path.

All three inherit from `SharedLabratory`, which holds the universal formulas (assembly success roll, weighted-value resource math).

---

## 2. Assembly success roll

**Source:** `Core3:server/zone/managers/crafting/labratories/SharedLabratory.cpp:143` (`calculateAssemblySuccess`).

```
inputs:
  player                 (CreatureObject*)
  draftSchematic
  effectiveness          ← tool effectiveness, -15..+15 typical

local:
  cityBonus     = skillMod("private_spec_assembly")        // up to 10 from player city
  assemblySkill = skillMod(draftSchematic.assemblySkill)
                + skillMod("force_assembly")                // force-sensitive bonus
  assemblyPoints = assemblySkill / 10.0                     // 0..12
  failMitigate   = (skillMod(assemblySkill) - 100 + cityBonus) / 7      // clamp [0, 5]
  failMitigate  += skillMod("force_failure_reduction")

  toolModifier  = 1.0 + effectiveness/100.0                 // 0.85..1.15
  craftbonus    = food_craft_bonus buff (Pyollian Cake) if active, else 0
  toolModifier *= 1.0 + craftbonus/100.0

  luckRoll      = random(0..99) + cityBonus

  if luckRoll > 95 - craftbonus:               return AMAZINGSUCCESS
  if luckRoll < 5 - craftbonus - failMitigate: luckRoll -= random(0..99)   // failure cascade
  luckRoll     += random(0, skillMod("luck") + skillMod("force_luck"))

  assemblyRoll  = toolModifier × (luckRoll + assemblyPoints × 5)

  if assemblyRoll > 70: return GREATSUCCESS
  if assemblyRoll > 60: return GOODSUCCESS
  if assemblyRoll > 50: return MODERATESUCCESS
  if assemblyRoll > 40: return SUCCESS
  if assemblyRoll > 30: return MARGINALSUCCESS
  if assemblyRoll > 20: return OK
  else:                 return BARELYSUCCESSFUL
```

**Tier enum** (`CraftingManager` constants):
- `AMAZINGSUCCESS = 0`
- `GREATSUCCESS = 1`
- `GOODSUCCESS = 2`
- `MODERATESUCCESS = 3`
- `SUCCESS = 4`
- `MARGINALSUCCESS = 5`
- `OK = 6`
- `BARELYSUCCESSFUL = 7`
- `CRITICALFAILURE = 8`

(Note `CRITICALFAILURE` is reachable in code only on the failure-cascade branch and only for experimentation; the assembly path's branch is commented out — see source.)

---

## 3. Weighted resource value

**Source:** `Core3:.../SharedLabratory.cpp:73` (`getWeightedValue`).

For a given stat index (`CraftingManager` constants: **`CR=1, CD=2, DR=3, HR=4, FL=5, MA=6, PE=7, OQ=8, SR=9, UT=10`** — index 0 is unused; see ER callout below), iterate every slot on the manufacture schematic:

```
nsum = 0; weightedAverage = 0
for each slot:
  if component slot (sub-component): use the component's value for that stat (custom ingredients only)
  if resource slot: use the resource spawn's value for that stat
  n    = draftslot.quantity            // how many units this slot consumes
  stat = ingredient.valueOf(statIdx)   // raw 0..1000
  if stat != 0:
    nsum            += n
    weightedAverage += stat * n
weightedAverage /= nsum
```

So `getWeightedValue(MA)` is the **units-weighted mean of MA across all filled slots**. Same shape for any stat. Slots with no value for that stat (or a non-custom component) skip the sum.

**ER (Entanglement Resistance) is not in Core3's crafting stat enum.** Resource spawns track ER and our `resources` table stores it, but no `CraftingManager` constant exists for it and no draft schematic's `resourceWeight` decodes to it. Origin: ER is a pre-CU resource attribute carried forward in GalaxyHarvester / SWGAide / our ingest pipeline for completeness, but Core3 (and therefore SR2) silently never weights it. **Simulator implication:** the property-group weights table (`schematic_property_weights`) will never contain an ER row; ignore ER when ranking resources for a slot. Resource Finder + Verdict Engine already respect this — they sum weights only for stats with `weight > 0`, and ER never appears.

**Sub-component nuance:** only *custom ingredients* (looted exotics, Bio-Engineer components, etc.) contribute their stat values. Vanilla crafted sub-components produce a finished item whose stats roll up through this same path — i.e. the parent schematic sees the sub-component as having effective stats determined by its own crafted values. This matters for the simulator: when modelling parent-with-sub-components, the sub-component's already-baked properties feed into the parent's `getWeightedValue`.

**Stat-index → attribute mapping** (from `Core3:ResourceSpawnImplementation.cpp:43`, the C++ side of `spawn->getValueOf(idx)`):

| Index | Constant | Resource attribute key |
|------:|----------|------------------------|
| 1     | `CR`     | `res_cold_resist`      |
| 2     | `CD`     | `res_conductivity`     |
| 3     | `DR`     | `res_decay_resist`     |
| 4     | `HR`     | `res_heat_resist`      |
| 5     | `FL`     | `res_flavor`           |
| 6     | `MA`     | `res_malleability`     |
| 7     | `PE`     | `res_potential_energy` |
| 8     | `OQ`     | `res_quality`          |
| 9     | `SR`     | `res_shock_resistance` |
| 10    | `UT`     | `res_toughness`        |

Unit-test fixture target: when the simulator decodes `typeAndWeight >> 4`, the resulting integer must map to one of these 10 constants. Any other value is a malformed draft schematic and should fail loudly in dev / log-warn in prod.

---

## 4. Initial percentages (post-assembly, pre-experimentation)

**Source:** `Core3:.../ResourceLabratory.cpp:39` (`setInitialCraftingValues`).

For each `resourceWeight` row on the draft schematic (a property group like `mindamage` with weights `{CD: 1, OQ: 1}`):

```
weightedSum = 0
for each weight-entry in resourceWeight:
  statIdx     = (typeAndWeight >> 4)         // which stat (1..10 per §3)
  percentage  = propertyPercentage           // 0..1, how much this stat contributes
  weightedSum += getWeightedValue(statIdx) × percentage

if weightedSum > 0:
  maxPercentage     = weightedSum / 1000                              // cap, e.g. weightedSum 940 → 94%
  currentPercentage = getAssemblyPercentage(weightedSum) × modifier
                      where modifier = calculateAssemblyValueModifier(assemblyResult)
  craftingValues.setCurrentPercentage(attribute, currentPercentage, maxPercentage)
```

**`getAssemblyPercentage(value)`** (`SharedLabratory.cpp:68`):

```
percentage = (value × (0.000015 × value + 0.015)) × 0.01
```

Quadratic-in-value curve. Sample table:

| weightedSum | starting % | maxPercent |
|------------:|-----------:|-----------:|
|         100 |       1.65 |         10 |
|         500 |      11.25 |         50 |
|         700 |      17.85 |         70 |
|         900 |      26.55 |         90 |
|         940 |      27.35 |         94 |
|        1000 |      30.00 |        100 |

So with perfect 1000-stat resources, you start at 30% and need experimentation to push toward 100%.

**`calculateAssemblyValueModifier(assemblyResult)`** (`SharedLabratory.cpp:59`):

```
AMAZINGSUCCESS   → 1.05    (5% bonus)
GREATSUCCESS  =1 → 1.10 - 1×0.10 = 1.00
GOODSUCCESS   =2 → 0.90
MODERATESUCCESS=3 → 0.80
SUCCESS       =4 → 0.70
MARGINALSUCCESS=5 → 0.60
OK            =6 → 0.50
BARELYSUCCESSFUL=7 → 0.40
```

So assembly tier directly scales the starting percentage. A Great Success on a 940-weightedSum resource set = `0.2735 × 1.0 = 0.2735` (27.35% starting). A Barely Successful = `0.2735 × 0.4 = 0.1094` (10.94%) — much harder to recover via experimentation.

---

## 5. Experimentation roll

Player presses "Experiment on row X with N points." Game runs two functions in sequence.

### 5a. `calculateExperimentationFailureRate` (the "effectiveness" metric)

**Source:** `Core3:CraftingManagerImplementation.cpp:43`. Misnamed — it's actually a success/effectiveness score, not a failure rate.

```
ma         = getWeightedValue(manufactureSchematic, MA)     // weighted MA from §3
expSkill   = player.skillMod(draftSchematic.experimentationSkill)
expPoints  = expSkill / 10.0                                 // 0..12

effectiveness = 50 + (ma - 500) / 40 + expPoints - 5 × pointsUsed
```

This is **exactly the SWGEmu wiki formula** the design doc references. Higher MA + higher exp skill + fewer points per attempt = higher effectiveness. Note `pointsUsed` is the count being spent on *this* attempt, not cumulative — fewer points per attempt = higher per-roll effectiveness, but more attempts needed.

### 5b. `calculateExperimentationSuccess` (the tier roll)

**Source:** `Core3:CraftingManagerImplementation.cpp:63`. Consumes `effectiveness` (above) as `effectiveness` parameter.

```
cityBonus           = skillMod("private_spec_experimentation")          // up to 10
experimentationSkill = skillMod(draftSchematic.experimentationSkill)
                     + skillMod("force_experimentation")
experimentingPoints  = experimentationSkill / 10.0

failMitigate         = (skillMod(assemblySkill) - 100 + cityBonus) / 7  // clamp [0, 5]
failMitigate        += skillMod("force_failure_reduction")

toolModifier         = 1.0 + effectiveness/100.0
expbonus             = food_experiment_bonus buff (Bespin Port) if active, else 0
toolModifier        *= 1.0 + expbonus/100.0

luckRoll             = random(0..99) + cityBonus

if luckRoll > 95 - expbonus - forceSkill:    return AMAZINGSUCCESS
if luckRoll < 5  - expbonus - failMitigate:  luckRoll -= random(0..99)
luckRoll            += random(0, luck + force_luck)

experimentRoll       = toolModifier × (luckRoll + experimentingPoints × 4)

if experimentRoll > 70: return GREATSUCCESS
if experimentRoll > 60: return GOODSUCCESS
if experimentRoll > 50: return MODERATESUCCESS
if experimentRoll > 40: return SUCCESS
if experimentRoll > 30: return MARGINALSUCCESS
if experimentRoll > 20: return OK
else:                  return BARELYSUCCESSFUL
```

Same enum shape as assembly. Note `experimentingPoints × 4` here vs `assemblyPoints × 5` in assembly — slight scaling difference.

### 5c. Apply the experiment result

**Source:** `Core3:SharedLabratory.cpp:21` (`calculateExperimentationValueModifier`) and `ResourceLabratory.cpp:120` (`experimentRow`).

Per-attribute percentage modifier table:

```
AMAZINGSUCCESS    → +0.080 × pointsAttempted
GREATSUCCESS      → +0.070 × pointsAttempted
GOODSUCCESS       → +0.055
MODERATESUCCESS   → +0.015
SUCCESS           → +0.010
MARGINALSUCCESS   →  0.000
OK                → -0.040
BARELYSUCCESSFUL  → -0.070
CRITICALFAILURE   → -0.080
```

Then for every attribute in the experimented property group:

```
newValue = currentPercentage(attr) + modifier      // clamped [0, maxPercent]
```

So at GREATSUCCESS on 3 points, the row's attributes all gain `+0.21` (21 percentage points). At BARELYSUCCESSFUL on 3 points, they lose `0.21`.

---

## 6. Manufacturing schematic bake — the irreversible commit

**Source:** `Core3:.../CraftingSessionImplementation.cpp:1445` (`createManufactureSchematic` — the "Create Schematic" stage 4 finaliser).

The bake writes the prototype + manufactureSchematic to persistence (`setPersistent(2)`) and moves the manSchem to the player's datapad. Factories spawn finished items from it using the **already-locked `craftingValues`** — every property's `currentPercentage` and `maxPercentage` is fixed. The man schem cannot be edited; resources used produce identical items forever.

This is what the simulator protects against. Phase 6's job: predict the `craftingValues` map the player would lock in if they baked this configuration, and let them iterate on the configuration (swap resources, change skill assumptions, A/B compare) before committing.

---

## 7. Other modifiers the simulator must account for

| Modifier | Source | Range | Notes |
|----------|--------|-------|-------|
| Tool effectiveness | crafting tool object's `getEffectiveness()` | -15..+15 typical | Private tools are higher quality. Drives `toolModifier`. |
| Crafting station presence | `CraftingSession.initializeSession(tool, station)` | binary | Without a station, only assembly is possible (no experimentation phase). |
| City bonus — assembly | `skillMod("private_spec_assembly")` | 0..10 | Mayor-granted spec; only active inside the city. |
| City bonus — experimentation | `skillMod("private_spec_experimentation")` | 0..10 | Same pattern, different spec. |
| Pyollian Cake | `BuffCRC::FOOD_CRAFT_BONUS` | typically +10 to +25 | Boosts assembly tier roll. Stacks multiplicatively into `toolModifier`. |
| Bespin Port | `BuffCRC::FOOD_EXPERIMENT_BONUS` | typically +10 to +25 | Boosts experimentation tier roll. Stacks multiplicatively. |
| Force-sensitive skill mods | `force_assembly`, `force_experimentation`, `force_failure_reduction`, `force_luck` | small bonuses | Add to base skill mods or fail-mitigate caps. |
| Luck skill mod | `skillMod("luck")` | varies | Adds a random bonus to `luckRoll` in both assembly and experimentation. |

**The design doc's "960 threshold"** does not exist as a literal in Core3 source. The closest analog is `maxPercentage = weightedSum / 1000` — to reach 100% experimentation result requires `weightedSum = 1000` (all caps perfect). With food buffs raising experimentation tier consistency, `weightedSum ≥ 960` is the *practical* threshold where a fully-buffed crafter is statistically near-certain to peg the cap. The simulator should surface this as "practical max" via Monte Carlo, not as a hard rule.

---

## 8. Experimentation point allocation

**Source:** `Core3:CraftingSessionImplementation.cpp:753-755`:

```
experimentationPointsTotal = skillMod(draftSchematic.experimentationSkill) / 10
```

So a player with 110 exp skill has 11 points. The player chooses how to distribute them across property-group rows (one experiment press = N points on one row). Optimal distribution depends on which properties matter most to the player; the simulator should support both:

1. **Player-driven allocation** — the user assigns points per row.
2. **Optimal allocation** — the simulator suggests an allocation (e.g. "all points into the row with the highest maxPercentage-currentPercentage delta on weighted-priority attributes").

`pointsAttempted` per press lowers per-roll effectiveness (via `-5 × pointsUsed` in §5a) but uses fewer presses. The simulator should also explore the "best presses per row" tradeoff — usually 2-3 points per attempt is optimal but it depends on skill.

---

## 9. Simulator implementation outline (Phase 6)

### 9.1 Pure-math core (`src/core/simulator/`)

Self-contained, unit-testable, no Drizzle/IPC. Mirrors `src/core/verdict/` boundary.

- `score.ts` — already exists; reused for weighted-value computation per stat.
- `assembly.ts` — implements §2 + §4. `simulateAssembly(slotResources, skill, tool, buffs, cityBonus, ...) → { tier, modifier, trials? }`. Two modes: deterministic-EV (compute expected tier from probability table) or Monte Carlo (1000 random rolls, return distribution).
- `experiment.ts` — implements §5. `simulateExperimentRow(currentPct, maxPct, points, skill, ma, tool, buffs, ...) → { newPct, tierDistribution }`.
- `manufacture.ts` — orchestrator. Takes a full slot configuration + skill profile + buff config + experimentation strategy, returns predicted `craftingValues` map (property → {currentPct, maxPct, EV}). This is what gets compared in A/B mode.
- `compat.ts` — already exists; resolves slot fit.

Math is pure; no DB. Unit tests cover the worked examples from §4's table plus the design doc §5.2.8 and one full-pipeline T21-style integration test.

### 9.2 UI (`src/renderer/src/routes/Simulator.tsx`)

Two-pane (design doc §5.7.2):

**Left — Slot configuration.** Each schematic slot gets:
- Source picker: inventory / current spawns / hypothetical
- For inventory: dropdown of owned resources matching the slot's compat
- For current spawns: dropdown of currently-spawning resources matching, with "would need to harvest" badge and planet/waypoint info
- For hypothetical: free-text stats input + optional cost-per-unit field
- Units required / units available

**Right — Predicted output.** For each experimental property group:
- EV at full experimentation (mean across N Monte Carlo trials)
- Distribution: best / 50th percentile / worst case
- Visual bar showing % of theoretical max
- "Confidence" indicator: roll variance
- Summary line: "this man schem will produce items at ~X% of theoretical max"

**Below right pane — Variant history.** Each slot mutation creates a new variant row; A/B comparison toggles split-pane delta view.

### 9.3 Skill/tool profile

The crafter needs to enter (once, in character profile):
- Their experimentation skill cap per profession
- Their assembly skill cap per profession
- Default tool effectiveness (or "I use a private tool +15")
- Default city bonus values
- Whether they're force-sensitive
- Standard buff usage (Pyollian + Bespin)

These plug into the simulator without per-craft re-entry.

### 9.4 A-vs-B comparison

Right pane splits vertically. Per-property: A value | delta | B value. Delta column colour-graded by direction. When prices are entered:
- **Total resource cost per item** (units × cost)
- **Effective ROI** if user has entered sale price + price elasticity (Δprice / Δquality)
- **Verdict** in plain English: "Worth it if you sell ≥10 of these"

### 9.5 Manufacturing-schematic-bake confirmation flow

Big red modal before the bake step: "You're about to lock in `craftingValues` for X. This is irreversible. Final stats: ..." with a "yes, bake" confirm. No mechanic in our app actually triggers a real bake (that's in-game), but the modal shapes the simulator workflow as "explore variants → confirm the one you'll commit to in-game → user clicks Confirm in our app which records the variant choice to history".

---

## 10. Open questions / things I didn't dig deep on

- **Bio-engineer special path** (`GeneticLabratory`, 707 LOC). Genuine fork. `setInitialCraftingValues` skips the `resourceWeight` loop entirely, requires `GENETICCOMPONENT` gameObjectType, reads named DnaComponent slots (`physique`, `prowess`, `mental`, `psychological`, `aggression`) instead of resources, and uses `calculateExperimentationValueModifier(...) * 2000.f` scaling (line 613) — different value range than the 0..1 percentage path. **Simulator input/output schemas differ entirely from generic:** input is DNA components not raw resources, output is creature-stat fields (resists, HP curves) not `craftingValues` percentages. Out of scope for Phase 6 v1; bio engineer needs a parallel `simulateBio` IPC channel.
- **Droid-engineer special path.** `DroidLabratory.cpp` is a 20-LOC stub inheriting `ResourceLabratory` — **the crafting math IS generic** (assembly success, weighted resource value, experimentation). But the player-meaningful output is downstream: `DroidMechanics.h` (`Core3:.../labratories/DroidMechanics.h`, 105 LOC of static methods) derives droid HP, speed, hit chance, min/max damage, and skill bonus per-chassis-type (`R_SERIES`, `DZ70`, `PROBOT`, `LE_REPAIR`, `MSE`, `POWER_DROID`, `PROTOCOL`, `SURGICAL`, `TREADWELL`, `BLL`) from the crafted `quality` value + a `rating` parameter. So for droid engineer, the simulator IPC needs the standard `craftingValues` output **plus** an optional per-chassis derived-stats rollup driven by `DroidMechanics::determineHam`/`determineSpeed`/`determineHit`/`determine{Min,Max}Damage`. Phase 6 v1 ships the generic path; the derived-stats add-on can be a thin v1.1 layer over the same simulator core.
- **Tool decay over time.** Crafting tools have durability that affects effectiveness. The simulator's "default tool effectiveness" assumption should be configurable per session, not pulled live from the player's current tool state.
- **Sub-component recursion in the simulator.** §3 notes sub-components feed their crafted values into the parent's `getWeightedValue`. The simulator needs to either (a) recurse all the way down — letting the player configure each sub-component's resources too — or (b) accept user-entered "I have these sub-components at these stat values" as hypothetical inputs. (a) is more powerful but the UI gets deep; (b) is simpler and matches how most crafters think.
- **Schematic dependency graph integration.** Phase 2 imported the parent→child schematic graph. The simulator should walk it when offering "Configure sub-components for this T21 build" UX.
- **Random seed handling.** Monte Carlo should be deterministic in test mode (seeded), production may use system random. Wire seeding through the Simulator IPC.
- **Price input source.** Phase 6 needs persistent storage for "my typical sale price" and "price elasticity" — likely a new `crafter_prices` table or extension to `characters`. Tiny addition.
