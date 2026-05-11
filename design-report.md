# GalaxyCrafter — Design Report

**Project:** GalaxyCrafter (working name)
**Author:** Ryan, with Claude
**Date:** 2026-05-10
**Status:** Pre-implementation brainstorm; design intent locked. All §7 open questions resolved 2026-05-10 (see resolution log in §7). Stack decision: Electron desktop. Workplan-architecture.md is the next document.

---

## Executive summary

GalaxyCrafter is a personal, lightweight, locally-running resource-collection assistant for Star Wars Galaxies emulator servers, built first against Sentinels Republic 2 (SR2) and architected so a single config switch points it at any other galaxy tracked by [galaxyharvester.net](https://galaxyharvester.net). It consumes Galaxy Harvester's daily resource export, layers a personal-aware verdict engine on top, and adds two features no existing tool nails: an inspectable crafting simulator that protects you from baking a bad resource configuration into a manufacturing schematic, and a new-player harvester-allocation planner that turns "I just rolled on this server with nothing" into a deterministic week-one workflow.

It is a 2026 reboot, not a green-field. The 2017 desktop app `lewismorgan/HarvesterDroid` already proves the consume-GH-and-rank-personally architecture works. GalaxyCrafter's job is to take that proof of concept, modernise the UX to dashboard-first / cards-first / mobile-responsive, and add three differentiating capabilities.

The three killer features, in priority order:

1. **Personal-aware verdict engine.** Every spawning resource is graded `CHASE / MAYBE / SKIP` *for you specifically* — by your professions, your active schematics, and what's already in your crates. Verdicts compose with independent `SB-for-X` flags so collectible server-best resources surface even when they fall outside your priority profession. Every verdict is drillable to the per-stat math that produced it.
2. **Crafting simulator.** Pick a schematic, see exactly what comes off the line. Primary use: protect against the irreversibility of manufacturing-schematic baking. Secondary use: A-vs-B comparison for "is this 300cr/unit auction resource worth it?" — answered with a concrete predicted delta, not a guess.
3. **New-player planner.** Detect an empty inventory; turn it into a prioritised survey + harvester-placement workflow: which planets to put your three lots on, which resources to hand-survey first, in what order. Zero-to-stocked in week one.

Everything else — resource browsing, schematic library, waypoint maps, despawn alerts — is table stakes that GH and HarvesterDroid already cover. GalaxyCrafter ships those because the tool is unusable without them, but they are not where it earns its existence.

---

## 1. The problem GalaxyCrafter solves

### 1.1 Galaxy Harvester is server-wide; you are not

GH is a tracker. It tells you what's spawning on SR2. It does not know:

- Which professions you actually craft.
- Which schematics inside those professions you actively run.
- Which resources are already in your crates and at what stat lines.
- Whether a given new spawn is a real upgrade for you or an indistinguishable lateral move.

The GH "Resource Finder" demands you fill in min/max for up to eight stats by hand, every time, per query. The "Top Resources" panel ranks by global percent-of-cap weighting, with no awareness of your inventory. The site is dense, table-driven, optimised for power users from 2010, and identical for a brand-new SR2 character and a year-deep weaponsmith. That mismatch is the gap.

### 1.2 HarvesterDroid is most of the way there but stale

`lewismorgan/HarvesterDroid` (Java/JavaFX, last release Aug 2017) consumes GH, lets you define schematics with weighted attributes, ranks current spawns, and marks resources as "owned." It gets ~80% of what we want conceptually. What it lacks:

- **Owned-aware verdicts.** It ranks globally; it doesn't say "you already have a 962 in this slot, this 945 is a SKIP."
- **Profession-prioritisation as a first-class filter.** You reconstruct it by toggling many schematics.
- **Crafting simulation** of the manufacturing-schematic-baking kind.
- **A new-player workflow** — it assumes you already know what you're doing.
- **2026 UX.** JavaFX desktop. No mobile. No keyboard triage. No "feels good" on a 2026 monitor.

HarvesterDroid is the precedent that confirms the architecture; GalaxyCrafter is the modern reboot of it with three additional differentiators.

### 1.3 SWGAide is the older sibling

[SWGAide](https://swgaide.com) — even older, also Java desktop, has a "Laboratory" feature whose URL pattern (`swgaide_help_schematics_laboratory_en.html`) suggests some form of crafting analysis. Page returned 403 during research; **verifying SWGAide's Laboratory before final design lock is an open question** (§7.2). If SWGAide already has a usable craft simulator, that doesn't kill the feature — it just sharpens our differentiation argument toward UX, A-vs-B framing, and inventory integration.

### 1.4 The new-player problem

Even granted GH + HD + SWGAide, none of them answer the question a new SR2 player actually asks: *"I have no resources, no harvesters down, three lots available, two accounts to hand-survey with. What do I do this week?"* That's a planning problem, and it benefits massively from a tool that already understands which resources matter for your chosen profession. GalaxyCrafter treats this as a first-class workflow.

---

## 2. The three killer features (overview)

These are the three places GalaxyCrafter must visibly out-class everything else. Detailed designs in §5; this section is the elevator pitch for each.

### 2.1 Personal-aware verdict engine

The engine takes every spawning resource on SR2 and emits, for each one, a single verdict — `CHASE`, `MAYBE`, or `SKIP` — with a one-line plain-English reason. Independent `SB` flags compose with the verdict so a resource can be (for example) `SKIP` for your personal craft list but flagged `SB_TOP_for_Armorsmith` so it shows in your "value collection" lane.

The verdict is computed from:

- The schematics on your **Active Crafting List** (e.g. T21 Heavy Carbine, DH17 Pistol Stock, Power Hammer Generic 5).
- The **profession priority** you've set (e.g. Weaponsmith primary, Artisan secondary, ignore everything else).
- The **resources you already own** with their stat lines and unit counts.
- The **server-best context** for the resource type — what's the current top across all SR2 spawns.

The output is not just a number. Click any verdict pill and you get the full breakdown: which schematics it scored against, the weighted score per experimental property group, the comparison to your current best in inventory, the delta, and the despawn urgency that pushed it up or down a tier. Math is deterministic and inspectable; you can override.

Worked examples in §5.2.

### 2.2 Crafting simulator

The simulator answers two questions, in priority order.

**Primary use case — manufacturing-schematic-bake protection.** In SWG, when you craft a practice item and select "Make Schematic," the resources used are *baked into* the resulting Manufacturing Schematic. Every weapon, armor piece, or component coming off that schematic for the entire factory run uses those exact stats, forever. You cannot change the resource configuration without re-crafting from scratch. This is one of the highest-leverage decisions a crafter makes and the one with the longest tail of regret. The simulator's headline workflow:

> Pick a schematic. Auto-populate slots from your owned inventory at the best per-slot resource. Show predicted experimental property values for the resulting man schem. Try alternatives. Lock the configuration only when you're sure.

**Secondary use case — A-vs-B buy decision.** Side-by-side compare two configurations: yours vs one that swaps in a hypothetical (or auction-listed) resource. Show the delta in plain numbers — "+0.7% damage per shot, –1.2% encumbrance" — and let you annotate cost. The simulator can then tell you: "this resource costs 75,000cr per gun's worth at 250 units; recovered at ~50 sales of +X damage; ROI breakeven 45 days at your current sales velocity."

Detailed math in §5.7.

### 2.3 New-player harvester-allocation planner

When the tool detects an empty or nearly-empty inventory, it switches the dashboard into a planning mode that walks the player through:

1. **What's spawning right now that you should care about?** Top 10 resources for your priority profession's most common schematic ingredient slots, sorted by cap-percentage and despawn urgency.
2. **Where do your harvesters go?** Given (e.g.) 3 lots and your top-priority resource needs, solve for the planet allocation that maximises coverage. If the best Aakuran Steel is on Dantooine and the best Polysteel Copper is on Naboo, plant accordingly.
3. **What do you hand-survey first?** Order the survey targets by: planet you're already on, despawn urgency, gap in your inventory, and concentration data. Optional: route-plan within a planet using the GH waypoint database so you're not driving back and forth.

Steps 1 → 3 turn into a checklist the player can mark off as they go. By the end of week one, the tool has converted the new player from "no resources" to "stocked enough to start crafting practice items." This is the workflow with the highest player-emotional payoff and the strongest differentiator vs anything else in the ecosystem.

Detailed design in §5.8.

---

## 3. Core principles

These are the design commitments that should be re-checked against any feature proposal. If a feature violates one, the feature changes — not the principle.

### 3.1 Personal-aware over generic

Every screen, every list, every recommendation is filtered or weighted by the user's professions, schematics, and inventory by default. A "show everything" mode exists for browsing but is not the home view. Generic per-cap-percentage rankings are available but always secondary to personal-aware ones.

### 3.2 Profession-prioritised, with SB tags as orthogonal flags

The user sets a strict profession priority (`primary, secondary, ignored`). Verdicts are computed in that priority order. Independent of verdict, every resource carries a set of `SB` flags — `SB_TOP_for_<profession>`, `SB_NEAR_for_<profession>` (within 5% of top, matching GH's definition) — so a resource the user doesn't craft for can still be visibly marked as a "valuable to hold or trade" item. The dashboard surfaces these in a separate lane so they don't drown out the personal verdicts.

### 3.3 Dashboard-first

Above every other screen is a single dashboard answering "what should I do right now?" — concrete, actionable, sorted by urgency. Tables, finders, schematic libraries are navigation away from the dashboard, not the dashboard itself. The dashboard works on phone, tablet, and desktop equally well.

### 3.4 Inspectable math; the player has the final say

Every recommendation, every verdict, every "we suggest you put a harvester here" is the output of a deterministic computation that can be displayed in full on demand. Clicking a verdict pill reveals the breakdown. Clicking a recommendation reveals the constraints used and the alternatives considered. The player can override any decision (mark resource as "ignore", mark schematic as "inactive", fix a profession ranking), and the override is honoured everywhere downstream. The tool does not hide its reasoning behind a magic number.

### 3.5 Local-first, single-user, offline-OK on the snapshot

GalaxyCrafter runs on the user's machine. No login, no cloud sync, no account. All data is local. Network access is needed only to pull the GH XML export every 12h or on manual refresh; once pulled, the entire tool works offline against the latest snapshot. There is no multi-user mode; there is no shared service; one instance per player. (Future, optional: export/import of personal config + inventory as a single JSON file for backup or migration.)

### 3.6 Fast, light, modern-feeling

Snappy response, dark by default, keyboard-first where possible, no spinners on routine operations, no full-page reloads on routine state changes. The bar is "feels good in 2026" — comparable in feel to Linear, Vercel dashboards, or Raycast. Packaged as an Electron desktop app (locked 2026-05-10, §7.4); specific renderer stack and packaging pipeline deferred to the workplan.

---

## 4. Data sources

### 4.1 Galaxy Harvester XML export (primary feed)

The canonical SR2 resource feed. URL pattern (verified from GH source `resourceDump.py`):

```
https://galaxyharvester.net/exports/current<GALAXY_ID>.xml
https://galaxyharvester.net/exports/current<GALAXY_ID>.csv
https://galaxyharvester.net/exports/all<GALAXY_ID>.xml      # full history
https://galaxyharvester.net/exports/all<GALAXY_ID>.csv
```

Where `<GALAXY_ID>` is the numeric ID assigned by GH for the server. SR2's exact ID is to be confirmed in the workplan phase by inspecting any SR2 resource page on GH — the URL contains the galaxy parameter.

Refreshed daily at 5pm UTC by GH's scheduled `resourceDump.py`. **Implication:** polling more than once per ~12h is wasted bytes — there is no fresher data to find. GalaxyCrafter's default cadence is twice daily (once shortly after the GH refresh, once 12 hours later) plus on-demand manual refresh.

The XML schema includes per-resource: name, type, planet(s), all 11 stats (`ER, CR, CD, DR, FL, HR, MA, PE, OQ, SR, UT`), `enteredBy` user, `addedDate`, current `availability` flag, and any submitted waypoints. SR2 resources are auto-uploaded by the `SR2Updater` GH bot account, so the feed reflects the live server within ~24h.

### 4.2 Bundled static reference

Ships with the app, refreshed on app version bumps:

- **Resource type tree with caps.** Every resource type and the per-type caps and floors for each of the 11 stats. Source: GH `tResourceType` data, cross-checked against [SWGAide's resource class info](https://swgaide.com/resources/restree.php) and Lunariel's resource cap guide.
- **Schematic library.** Every schematic, its ingredient slots (resource type families per slot, units required), its experimental property groups, and the per-stat weights. Source: GH `tSchematic`, `tSchematicIngredients`, `tSchematicQualities`, `tSchematicResWeights`. For SR2-specific custom schematics that haven't been added to GH (e.g. unique Republic-themed gear), see §4.4.
- **Profession → schematics mapping.** Crafting tabs and tier ordering per profession.
- **Resource group → category hierarchy.** Mineral / Organic / Gas / Water / Chemical / Energy, etc. and their subgroups.

### 4.3 User input (locally-managed state)

- **Owned inventory.** Resources you currently hold, with units, character ownership, and storage location (crate / vendor / stash). Manual entry to start; later, OCR or in-game mail import (§4.5).
- **Profession priority list.** Per character: ranked profession list with `primary / secondary / ignored` tier.
- **Active crafting list.** Per character: schematics you actively run, optionally with target stat ratios overriding the schematic defaults.
- **Verdict overrides.** "Always alert me on Aakuran > 950 OQ even if SKIP." "Never alert on chemicals." Etc.
- **Notes & tags.** Free-form annotation on any resource, schematic, or character.

### 4.4 Custom (SR2-specific) schematics — deferred

**Decision 2026-05-10 (§7.3):** v1 ships vanilla schematics only. Custom SR2-specific schematics (Republic Gunship variants, etc.) are deferred until much later. Rationale: the vanilla Core3 codebase is available locally and the project's knowledge base covers vanilla mechanics deeply; the verdict engine and simulator can be fully validated against vanilla schematics first.

If/when custom-schematic-admin is added (post-v1), the design is: the user defines a custom schematic in-app — ingredient slots with resource-type-family pickers, experimental property groups with weights, optional output description. These behave identically to bundled schematics in the verdict engine and simulator.

### 4.5 In-game survey droid mail import (later)

SWG's interplanetary survey droid sends an in-game mail with concentration data per resource on the planet you sent it to. SWG mail is exportable as `.mail` files from the game's profile directory. Both GH and SWGAide already parse these. GalaxyCrafter should support drag-and-drop of `.mail` files for two purposes:

1. **Inventory verification** — confirm what you actually surveyed shows up in your owned list.
2. **Concentration update** — feed back to local waypoint estimates without round-tripping through GH.

This is a comfort feature, not a v1 requirement.

---

## 5. Feature catalog

### 5.1 Dashboard

The single home screen. Layout is responsive within the Electron window — wide windows show three to four lanes side-by-side; narrow or docked windows stack them.

**Lane 1 — Right Now.** The top 5 `CHASE` resources sorted by despawn urgency. Each card shows resource name, type, top two stats with progress bars, planet + waypoint, despawn estimate, and the one-line verdict reason. Click → resource detail.

**Lane 2 — On Watch.** The next 10 `MAYBE` resources, same card format. Filtered out by default if the user prefers a tighter dashboard. Configurable.

**Lane 3 — SB Collection.** Resources flagged `SB_TOP_for_<X>` or `SB_NEAR_for_<X>` regardless of personal verdict. The "value lane" — these are not for your craft list, but they're rare and worth grabbing for trade. Sorted by SB tag rarity.

**Lane 4 — Inventory health.** Quick gauges:
- Schematic readiness (out of your active schematic list, how many can be crafted today from inventory? colour-coded).
- Empty-slot map for top 5 schematics by priority.
- Resources in your stash that just despawned in-game (no longer reservable on harvesters; flagged for use-it-or-lose-it).

**New-player mode.** When inventory is empty or below a threshold, lanes 1–3 are replaced by the new-player planner workflow (§5.8). Lane 4 still shows but is more aspirational than diagnostic.

**Live updates.** When a snapshot ingest completes, a non-disruptive toast announces "X new spawns since last refresh, Y CHASE-tier" and the dashboard re-renders without a page reload.

### 5.2 Verdict engine (in detail)

The heart of the tool. Goal: every resource, every refresh, gets a single personal verdict and any number of independent SB flags, computed deterministically and explainably.

#### 5.2.1 Inputs per resource

- The resource's stat values across all 11 attributes.
- The resource's type and the type's per-stat caps and floors.
- The set of schematics on the user's active list whose ingredient slots accept this resource type.
- For each matching schematic: the experimental property groups and per-stat weights.
- The user's owned resources of compatible types and their stat values.
- The user's profession priority and any overrides.
- The current SR2 server-best for this resource type, computed across the snapshot.
- The resource's despawn estimate (from `addedDate` + type's typical lifetime).

#### 5.2.2 Per-schematic, per-property-group score

> **Errata (2026-05-11):** the formula below originally referenced per-resource-type `cap` and `floor`, but the §5.2.8 worked example used universal `cap=1000 floor=0` for both stats — and the worked example reflects what the SWG experimentation engine actually computes. Universal bounds is the correct convention; per-type bounds inflates resources that peg narrow-cap types and understates resources with high absolute stats on wide-cap types. The implementation (`src/core/verdict/score.ts`) uses universal bounds; the §5.2.5 verdict rules and §5.6 Resource Finder ranking both consume this corrected score. Per-type cap/floor is still imported and surfaced on the §5.5 stat bars as "% of cap" — a legitimate but separate "is this spawn good for its type?" question.

For a schematic ingredient slot that accepts this resource type, and an experimental property group with weights `{stat_i: w_i}` where `Σ w_i = 1`:

```
score = 100 * Σ over stats: w_i * (resource.stat_i / 1000)
```

A resource with the universal max (1000) on every weighted stat scores 100; one at 0 scores 0. The 0-1000 range matches the universal scale that SWGEmu's experimentation formula uses for raw stat inputs.

#### 5.2.3 Owned-best score

For the same slot + property group, find the user's currently-owned resource with the highest score:

```
score_owned = max over owned resources of compatible type: score(owned_resource)
            = 0 if user owns nothing of compatible type
```

#### 5.2.4 Server-best score

Across the snapshot's currently-spawning resources of compatible type:

```
score_sb = max over spawning resources of compatible type: score(spawn)
```

#### 5.2.5 Delta and verdict

```
delta_owned = score - score_owned
delta_sb    = score - score_sb         # almost always ≤ 0; how close to the top

verdict_for_one_schematic_one_group:
    CHASE  if score_owned == 0          # fills empty slot
         | delta_owned >= 8 AND schematic.profession in user.priority_set
         | score >= 90 AND delta_owned >= 3
    MAYBE  if delta_owned >= 3
         | score >= 85
    SKIP   otherwise
```

The thresholds (8, 3, 85, 90) are configurable per user; the defaults are ballpark, refined in real use.

#### 5.2.6 Roll-up across schematics

A resource will typically match multiple schematics across multiple property groups. Final verdict for the resource = max across all (schematic, group) pairs, weighted by the schematic's profession priority:

- If the resource is `CHASE` for a primary-profession schematic, final = `CHASE`.
- If the best is `CHASE` only for a secondary-profession schematic, final = downgrade by one tier (so secondary `CHASE` becomes `MAYBE` on the dashboard, but the underlying schematic-level `CHASE` is still visible on drill-down).
- If the best is `MAYBE` for primary, final = `MAYBE`.
- Otherwise `SKIP`.
- **Sub-component schematics inherit their parent's priority tier.** A Stock schematic auto-imported as a sub-component of a primary-profession Carbine (§5.4.1) is treated as primary-tier in this roll-up. Resources that only fit sub-component slots are scored against the inherited tier, not the bare profession default.

#### 5.2.7 SB flags (orthogonal to verdict)

Independently of the verdict, for each profession:

```
SB_TOP_for_<profession>  if score(resource, profession's_top_schematic) == score_sb
SB_NEAR_for_<profession> if score >= 0.95 * score_sb     # within 5%, GH definition
```

A resource can be `SKIP` (irrelevant to your craft list) and `SB_TOP_for_Bio_Engineer` (collectible value) at the same time. The dashboard's SB lane shows it; the personal verdict lane doesn't. These are two independent axes.

#### 5.2.8 Worked example

You're a Weaponsmith primary, Artisan secondary. Active schematics include T21 Heavy Carbine (Stock slot weights: 66% OQ, 33% SR). Your owned crate has Aakuran Steel at OQ 940, SR 800 → score 0.66·(940-cap_floor)/(cap-floor) + 0.33·(800-...). Plug in cap 1000, floor 0 for simplicity → score = 0.66·94 + 0.33·80 = 62.04 + 26.4 = 88.44.

A new spawn appears: Polysteel Copper, OQ 968, SR 821. Polysteel Copper is also accepted in the Stock slot. Score = 0.66·96.8 + 0.33·82.1 = 63.89 + 27.09 = 90.98. Delta vs owned = +2.5; not enough alone for `CHASE`. But you don't own Polysteel Copper at all, so for *this* schematic's slot you're getting an option you didn't have. If Polysteel Copper isn't in your inventory at all, `score_owned == 0` for slots that *only* accept Polysteel Copper, triggering `CHASE`. If the slot accepts both Aakuran and Polysteel and you have Aakuran, the resource's `CHASE` for that slot is suppressed to `MAYBE`.

If Polysteel Copper is also `SB_TOP_for_Architect` (the Architect's Wall Module schematic uses it heavily and 968/821 is the current SR2 best), the resource gets the `SB_TOP_for_Architect` flag regardless of your verdict. Your dashboard's SB lane shows it.

The verdict pill on the resource card reads `MAYBE` (primary: Weaponsmith, +2.5 delta on T21 Stock; SB_TOP for Architect). Click → full breakdown: every schematic this matched, every property group, score, delta, owned comparison, despawn timer.

### 5.3 Personal inventory ("My Crates")

Tracks what you own. Per-character, per-resource, with units. Statuses:

- **Live** — still spawning on the server, your harvesters can keep extracting it.
- **Banked** — despawned from the server; what's in your crate is all you'll ever have.
- **Reserved** — you've earmarked these units for a specific schematic build (so they're excluded from "available" totals on the dashboard).

Manual entry to start. The Add Resource flow looks up partial names against the current GH snapshot — type two letters of "Aakuran" and the autocomplete shows all Aakuran-prefixed spawns with their stats; pick one and units default to a guess. Faster than typing 11 stat values.

Later quality-of-life:

- Drag-and-drop a `.mail` file from your SWG profiles directory; we parse the survey droid output and pre-fill multiple resources at once.
- OCR a screenshot of your in-game inventory window; partial fill, user verifies. (Lower priority — same feature exists in the GH mobile app and is finicky.)
- "Bulk reserve" — select N schematic builds and have the tool set aside the appropriate units across resources.

### 5.4 Schematic library + active list

Browse: full SWG schematic tree by profession and crafting tab. Filter by ingredient resource type (e.g. "show me every schematic that uses Steel"), by experimental property (e.g. "every weapon affected by OQ/CD"), or by tier.

Active: the schematics you actually run. The verdict engine treats this list as canonical. Adding a schematic to active is one click from any browse view. You can clone a schematic and override its property weights for niche cases (e.g. a "high-encumbrance, low-damage" build).

Custom: define an SR2-specific schematic by hand if it isn't in the bundled library.

#### 5.4.1 Schematic dependency graph (sub-components)

A schematic in SWG often consumes the *output* of other schematics, not just raw resources. T21 Heavy Carbine is the parent; it requires components like Stock, Barrel, Core, Trigger Group, Power-up Kit. Each of those is its own schematic with its own resource ingredients and experimental properties. A weaponsmith who declares "T21 Heavy Carbine is my priority" really means "all of T21 + every sub-component schematic I'll craft myself" is a priority.

GalaxyCrafter models this as a dependency graph:

- **Auto-suggest on add.** Adding a parent schematic to the active list auto-suggests every sub-component schematic and prompts the user to confirm: "do you craft this sub-component yourself, or buy/loot it?"
- **Transitive priority inheritance.** Confirmed sub-components inherit the parent's profession-priority tier. A Stock for a primary-profession Carbine is treated as primary-priority for verdict purposes, even if Stock crafting could nominally sit under a secondary profession.
- **Per-sub-component override.** The user can override on any sub-component (e.g. "I buy Cores from a specialist" — the Core schematic is *not* on my active list and Cores' resource needs don't drive verdicts).
- **Resource detail shows the chain.** The Resource Detail view (§5.5) shows the full dependency chain when a resource fits a sub-component slot: "this Steel fills a Stock slot; the Stock feeds T21 Heavy Carbine (your primary)."
- **Simulator recurses.** When simulating a T21 Heavy Carbine, the simulator (§5.7) recursively expands every sub-component schematic on the active list and auto-populates each sub-component's slots from best-owned-or-spawning resources, with the same override controls. The output reflects the full assembled item, not just the parent's direct resource slots.

Transitive priority is the single most important consequence: it means the verdict engine correctly treats Steel as a primary-priority resource *because* Steel feeds Stock feeds Carbine, without the player having to manually mark every sub-component schematic as primary. Without dependency-graph modelling, every weaponsmith would need to add ~30 sub-component schematics by hand and toggle priority on each. With it, "I craft T21 Heavy Carbines" is enough.

### 5.5 Resource detail view

Per-resource page. Above the fold:

- Resource name, type, image (from GH if available), entered-by user, age, despawn estimate.
- All 11 stats with progress bars showing percent-of-cap and the cap value beside.
- Verdict pill with reason. Click → full breakdown panel.
- Spawning planets + waypoint markers on a small map.

Below:

- **Fits these schematics.** Every schematic from the bundled and active lists this resource type can fill.
- **Slot-by-slot rank.** For each fitting slot, the resource's score, your owned-best for that slot, and the delta.
- **If collected.** "Adding 1000 units of this would upgrade your readiness on T21 Carbine, DH17 Stock, and 4 other schematics." A direct payoff line.
- **Concentration map.** Best-known waypoints from GH, plus any waypoints you've added from your own surveying.
- **Despawn urgency.** Estimated remaining lifetime, colour-coded.

### 5.6 Resource Finder (schematic-driven)

GH's Resource Finder asks for min/max per stat. GalaxyCrafter's flips the model:

- Pick a schematic from your active list (or browse). Weights auto-fill from the schematic's experimental property groups. You can edit them.
- Optional: minimum threshold per stat (rarely needed once weights are set).
- Result: ranked list of all currently-spawning resources, scored against the chosen weights, with owned-flag, despawn timer, and one-line "why this rank" reason.
- Toggle: cards or rows (§6.2).

### 5.7 Crafting simulator (in detail)

The feature with the highest player-emotional payoff after the verdict engine. SWG crafting math is well-documented; the tool's job is to wrap it in an interactive workflow.

#### 5.7.1 SWG crafting math (primer)

Two phases, both deterministic given inputs and skill:

**Assembly phase.** When you craft a practice item, the game rolls assembly success based on:
- Skill (your assembly modifier for this schematic family).
- Tool quality (private and crafting tools have different effective bonuses).
- Crafting station bonus (public/private station).
- The weighted-MA of resources used (`Average_MA = Σ (units_in_slot * MA_of_resource) / total_units`).

Assembly result drives the *starting experimentation percentage* for each property group.

**Experimentation phase.** For each experimental property group on the schematic:

```
success_rate = (50 + (Average_MA - 500)/40 + Experiment_Skill - 5*Points_Used) / 100
```

(Source: [SWGEmu Wiki Experimentation Formula](https://swgemulator.fandom.com/wiki/Experimentation_Formula).)

The 960 stat threshold is the "key value" — if the weighted score for the property group is ≥ 960 *before* the food/MA buff, a buffed crafter has the opportunity to reach a 100% experimentation result. Below that, the cap on result is lower.

For a property group with multiple stats and weights, a separate roll is made per stat and the engine compensates for one being lower than another via an internal factor.

**Manufacturing schematic baking.** When you finish the practice item and select "Make Schematic," the resources used and their weighted contribution to each property group are baked in. Every item produced by a factory using that man schem inherits those experimental property values. **You cannot edit a manufacturing schematic once made.** This is the irreversibility the simulator protects against.

#### 5.7.2 The simulator UI

A two-pane interface:

**Left pane — slot configuration.** Every ingredient slot on the chosen schematic, with three sources per slot:

1. **From your inventory.** Dropdown of every owned resource compatible with the slot, sorted by score. Default selection: top-scoring owned resource.
2. **From current spawns.** Resources currently on SR2 you don't own. Marked with "would need to harvest" badge and planet/waypoint info.
3. **Hypothetical.** Manually enter stats for a resource you might buy or anticipate. Optional cost-per-unit field.

For each slot, units required and units available (from inventory) are shown.

**Right pane — predicted output.** For the selected configuration:

- Per experimental property group: predicted result percentage at full experimentation, accounting for assembly success expectation and the user's Experiment_Skill (which the user enters once in their character profile).
- Predicted final-item experimental property values, colour-coded vs the schematic's theoretical max.
- "Confidence" indicator — how tight the experimentation roll variance is given the inputs.
- A summary: "this man schem will produce weapons with ~X% damage of theoretical max, every unit, for the life of the schematic."

Below: a **history of variants** — each time you tweak a slot, a new row is added to the variant list with a delta vs the baseline. Click any variant to switch back. This becomes the audit trail for the decision.

#### 5.7.3 A-vs-B comparison mode

A toggle on the simulator splits the right pane vertically: variant A on the left, variant B on the right, and a delta column in the middle. Each delta is a real number ("+0.7% damage", "–1.2% encumbrance", "–4 units total"), not a colour.

When variants are annotated with cost-per-unit (for hypothetical or auction-listed resources), the delta column also shows:

- **Total resource cost per item** (e.g. "+75,000cr per gun").
- **Effective ROI** if the user has entered their typical sale price for finished items: "+7,500cr per gun at +0.7% damage" → "ROI breakeven at 10 sales."
- **Verdict** in plain English: "Worth it if you sell ≥10 of these. Skip if you're crafting for personal use."

This is the second-most-asked question in any SWG crafter Discord ("is this rare resource worth buying?") and GalaxyCrafter answers it deterministically.

#### 5.7.4 Worked example — manufacturing schematic protection

You're about to bake a man schem for T21 Heavy Carbine using your current best resources. The simulator shows: predicted Damage 86%, Speed 91%, Wound Chance 78%. You've owned the inputs for two months and assumed they were good.

Side panel shows "If you swapped Slot 4 (Polymer Compound) from your Hexafluorine Polymer (PE 891, OQ 902) to your stash's other option, Carbonite (PE 850, OQ 945) — predicted Damage drops 1.4%, Speed unchanged, Wound Chance climbs 3%." A glance, you have the trade-off priced. You don't bake the schematic until you've explored three or four variants. Hours of in-game crafting saved; ill-considered factory runs prevented.

#### 5.7.5 Worked example — buy decision

You see a vendor selling Aakuran Steel at OQ 968, SR 821 for 300cr/unit. Your inventory has Aakuran at OQ 940, SR 800. Variant A is your owned config; variant B swaps the Stock slot to the vendor's Steel. Sim outputs: predicted Damage +0.6%, schematic-roll variance unchanged. The Stock slot consumes 250 units → +75,000cr added resource cost per gun.

You enter (once, in your character profile) two annotations the simulator uses for ROI math: typical sale price for this gun (50,000cr) and your estimate of how much +1% damage moves the sale price (+500cr per gun is a reasonable default; configurable). The simulator computes: variant B's +0.6% damage supports +300cr per gun → breakeven at 75,000 / 300 = **250 sales per gun**. Variant B is marked `SKIP unless personal craft` with the full math drillable. You walk away from the vendor.

The same machinery handles the inverse: paste a forum-posted resource someone is selling, simulator runs the comparison, you get a definitive yes/no with the breakeven number. This shape — explicit added cost, explicit predicted output delta, explicit price elasticity, explicit breakeven volume — is what makes the simulator's recommendations trustworthy.

### 5.8 New-player mode (in detail)

Entered automatically when:
- Inventory has fewer than `N` resources (default 5), OR
- The user explicitly enables "Plan my first week."

The dashboard transforms into a guided workflow. Top of screen: a step indicator showing where the player is.

**Step 1 — Confirm professions.** Walk through profession priority once: primary, secondary, ignored. Defaults guess from any character data the user enters.

**Step 2 — What to chase right now.** A specifically new-player-shaped list:
- Top 10 currently-spawning resources for the priority profession.
- Sorted by a weighted heuristic combining resource score, despawn urgency, and planet concentration — each normalised to [0, 1] before combining; default weights are equal, configurable. The intent: a 95-score resource on a planet with 3 strong waypoints despawning in 8 hours floats above a 97-score resource you'd have to drive across an empty planet to reach. The heuristic is exposed in settings so a power user can tune it (e.g. weight despawn-urgency higher if their playtime is bursty).
- Each entry: planet, top 1–2 waypoints, expected concentration, despawn estimate, "this resource fills the X slot for these schematics."

**Step 3 — Harvester allocation.** If the user has indicated they have `K` lots:
- The tool computes a `K`-planet allocation that maximises coverage of the top resource needs.
- Each planet recommendation shows: which resources are currently strong there, expected lifetime of the strongest spawn, and a score for the allocation.
- If two allocations score within `M%` of each other, both are surfaced and the user picks based on personal preference (e.g. "I have 4 alts on Naboo, default to Naboo when scores are tied").

**Step 4 — Survey route.** Within each chosen planet, an ordered list of resource-survey targets with concentration data and waypoint references. Mark each off as you go.

**Step 5 — Exit criteria.** When the player has `N+` resources stocked and at least one harvester running, the dashboard automatically returns to standard mode. The new-player workflow is archived to a "first week summary" page they can revisit.

This workflow turns the most intimidating moment in a new SR2 character's life — "where do I even start" — into a clear week of action. It's the feature most likely to get GalaxyCrafter shared in SR2's Discord.

### 5.9 Multi-character / multi-profession

Add up to N characters. Per character: profession priority list, active schematics, inventory subset (which crates belong to which alt). One unified dashboard rolls up across all characters; per-character drill-downs available.

The verdict engine respects character boundaries: a resource that's `CHASE` for Char A's Weaponsmith but `SKIP` for Char B's Tailor shows on the dashboard's main lane (because A's primary profession matched), but Char B's drill-down view doesn't surface it.

### 5.10 Profession priority + SB tagging (composability)

Profession priority is set per character. Each tier (`primary, secondary, ignored`) carries a default verdict-threshold modifier (primary uses base thresholds; secondary requires +50% delta to upgrade verdict; ignored never produces verdicts but still gets SB tags).

SB tags are computed across all 13 SWG professions regardless of priority. The dashboard's SB lane is a single feed of "rare and valuable, by independent measure" — orthogonal to your personal craft list.

The user can configure per-tag visibility ("show SB_TOP for any profession; hide SB_NEAR for ignored professions"), and per-resource overrides ("never alert me on resources of type X").

### 5.11 Notifications

Layered, opt-in:

- **In-app live diff toast.** On every snapshot ingest, "X new spawns since last refresh, Y CHASE-tier" with a click-through.
- **Desktop OS notification.** Optional, fires only on `CHASE` verdicts or specific SB tags the user has subscribed to.
- **Discord webhook.** Post to your own Discord. Useful for guild-shared crafters.
- **Email.** Optional, batched daily summary.

All notifications carry the verdict reason in the body, not just the resource name.

### 5.12 Despawn lifecycle / urgency

Resources have estimated remaining lifetime computed as `type.typical_lifetime - (now - addedDate)`. Confidence falls as the estimate approaches 0; hard despawn detection is when GH's `availability` flag flips.

Visualisation:

- **Days remaining ≥ 3:** neutral.
- **Hours remaining 24–72:** warm tint.
- **Hours remaining < 24:** orange border.
- **Hours remaining < 6:** red border, fire emoji on the dashboard card.
- **Despawned this snapshot:** archived to a "use it or lose it" inventory section if the user owns any.

The new-player planner and dashboard both factor urgency into their sort order so the player chases the about-to-despawn first.

### 5.13 Waypoints / concentration / survey route planner

For any resource:
- Pass-through display of GH's submitted waypoints with concentration data.
- "Your routes" — a planner that takes a list of resources you want to survey and proposes an ordered visit sequence on a single planet, minimising travel time. Visual route on the planet map.
- Personal waypoint additions if you find a better spot than what's in GH; optionally upload back to GH using the `postResource` API (consent prompt; defaults off).

### 5.14 Customisation & settings

- **Theme.** Dark default, light option, optional custom CSS for the power user.
- **Verdict thresholds.** Override the defaults (CHASE delta = 8, MAYBE delta = 3, etc.) per user preference.
- **Layout.** Cards or rows toggle on every list view (§6.2).
- **Notification rules.** Per tier, per channel, per profession, per resource type.
- **Profession rules.** Ranking, custom SB-tag visibility, ignore lists.
- **Custom schematics.** Add SR2-specific schematics (§4.4).
- **Custom resource types.** If SR2 ever introduces a wholly new resource type, define it locally.
- **Snapshot cadence.** Default 12h; configurable; manual-refresh button always available.
- **Data export.** Full personal config + inventory as a single JSON file for backup, transfer, or share.

---

## 6. UI / UX direction

The bar is "feels good in 2026." Concrete commitments below; the underlying stack and component library are deferred to the workplan.

### 6.1 Dashboard pattern

Single-page on first load. Lanes (§5.1) reflow to a stack on mobile. No modals on the dashboard — drill-downs are inline expansions or full-page navigates.

### 6.2 Cards over rows (with row toggle)

Default view for every list is cards: each resource is a tile with name, verdict pill, top-2 progress bars for the most schematic-relevant stats, planet, despawn timer, and reason text. A toggle in every list view switches to dense rows for traditionalist users (and for power-user moments where you need to scan 200 resources at once). The toggle persists per view per user.

### 6.3 Verdict pills

`CHASE` = solid green. `MAYBE` = soft yellow. `SKIP` = muted grey. SB tags are independent chips alongside the verdict pill, with their own colour code by SB tier (`SB_TOP` = blue, `SB_NEAR` = pale blue). Pills are clickable; click reveals the math breakdown in an inline expanding panel (no modal).

### 6.4 Stats as progress bars

Numbers like 968 are unreadable without context. Progress bars show percentage of cap, with the absolute number rendered small below or on hover. Every stat-bar is the same size; the visual length is the information.

### 6.5 Despawn-urgency visual layer

The card border colour and an emoji (or icon) reflect remaining lifetime per §5.12. Red-bordered cards on the dashboard mean "decide right now."

### 6.6 Keyboard triage

On any list view: `c` mark current as "chased" (acknowledged), `s` mark as "skipped" (suppress for this snapshot), `?` open the verdict breakdown, `r` open resource detail, `j/k` move down/up, `/` focus search.

### 6.7 Window-responsive (desktop primary)

Layout reflows gracefully across Electron window sizes — full-screen, half-screen, docked panel. No mobile build planned (§7.4 locked desktop-only). Minimum useful window width is roughly 720px; below that the dashboard lanes stack and secondary chrome hides.

### 6.8 Inspectable click-through

The principle made visible: every recommendation, verdict, allocation, or rank is one click away from its full underlying math. Breakdowns include: the inputs used, the formula applied, the comparison set, the alternatives considered, and the user-controllable thresholds that produced the result. Nothing is opaque.

### 6.9 Dark by default

Default theme is dark. Light mode is a toggle. Both themes are full implementations, not afterthoughts.

### 6.10 Speed

Snapshot ingest, verdict recomputation, and dashboard re-render must complete in under 2 seconds on a current laptop. List views must paginate or virtualise so a 5,000-resource snapshot doesn't blow up the DOM. No spinners on routine state changes — use optimistic UI where the local op is deterministic.

---

## 7. Open design questions — resolved 2026-05-10

All 11 questions resolved by Ryan on 2026-05-10. Summary table:

| §    | Topic                                          | Resolution                                                         |
|------|------------------------------------------------|--------------------------------------------------------------------|
| 7.1  | HarvesterDroid empirical test                  | **Skip** — HD no longer maintained                                  |
| 7.2  | SWGAide Laboratory scope                       | **Skip** — not blocking                                             |
| 7.3  | SR2 custom schematic coverage in GH            | **Skip / defer** — v1 vanilla only; revisit much later              |
| 7.4  | Desktop app vs local web app                   | **Locked: Electron desktop**                                        |
| 7.5  | OCR / mail-import feasibility                  | **Skip for now** — manual entry only in v1                          |
| 7.6  | Crafting simulator validation                  | **Build first, validate + tune after**                              |
| 7.7  | Resource type / cap database accuracy          | **Pull from vanilla Core3 (local clone) + Phase 1 mod resource research** |
| 7.8  | SR2-specific Galaxy ID lookup                  | **Action item during workplan setup**                               |
| 7.9  | Notification fidelity                          | **Electron native notifications** (follows from 7.4)                |
| 7.10 | Waypoint route-planner scope                   | **Skip** — likely v2 / not v1                                       |
| 7.11 | Stale manufacturing schematic detection        | **Confirmed v2** — flag retained                                    |

The original question text remains inline below as a record of what was explicitly considered.

### 7.1 HarvesterDroid empirical test

Run HD against SR2 for one week. If its 2017 UX is tolerable for the 80% of features it covers, GalaxyCrafter's scope can shrink: ship as a verdict-engine + crafting-sim sidecar that consumes HD's exports rather than re-implementing the whole tool. If HD breaks against current GH or its UX is intolerable, full reboot is justified. **Cost:** ~30 minutes to install + run HD; ~1 week of light use to evaluate.

### 7.2 SWGAide Laboratory scope

Verify whether SWGAide already has a usable crafting simulator. URL pattern (`swgaide_help_schematics_laboratory_en.html`) suggests yes; help page returned 403 during research. Direct test: install SWGAide, find the Laboratory feature, evaluate against the simulator design in §5.7. If SWGAide already covers the core simulator, GalaxyCrafter's differentiation shifts toward inventory integration, A-vs-B framing, and UX modernisation — still defensible, but the positioning changes.

### 7.3 SR2 custom schematic coverage in GH

Pull the GH XML export for SR2 and audit: what fraction of SR2's custom schematics (Republic gear, custom weapons) are in GH's schematic database? If high, custom-schematic-admin (§4.4) is a fallback for edge cases; if low, custom-schematic-admin is a v1 requirement. **Cost:** half a day to inventory.

### 7.4 Whether to ship as desktop app or local web app

Local web app (browser at `http://localhost:port`) vs Tauri/Electron-packaged desktop app. Web is easier to develop and update; desktop has a tidier launch experience. Decision likely depends on how many Windows/Mac users will use it (the broader the audience, the more desktop matters) — but principles in §3.5 (local-first) and §3.6 (modern feel) are agnostic to which we pick. Defer to workplan.

### 7.5 OCR / mail-import feasibility

`.mail` parsing is well-trodden — both GH and SWGAide do it. OCR of in-game inventory windows is finicky. Both can wait until v2; v1 is manual entry with snapshot-autocomplete (§5.3).

### 7.6 Crafting simulator validation

Can we validate simulator predictions against actual in-game craft results? A small test plan: pick 5 schematics, craft each in-game with known resources, compare predicted vs actual experimental property values. Iterate the simulator's formulas until predictions are within ~2% of actuals. This is a v1 polish item, not v1 blocking. **Cost:** 2-3 evenings of in-game crafting + tuning.

### 7.7 Resource type / cap database accuracy

The 11-stat caps per resource type are the lookup table the entire engine depends on. SWGAide and Lunariel's guide are the canonical sources. We need to import one and audit it; mismatches produce wrong scores everywhere. Likely a one-time data ingest.

### 7.8 SR2-specific Galaxy ID

Look up the numeric `<GALAXY_ID>` for SR2 on GH. Trivial — load any SR2 resource page, the URL contains the ID. Worth recording in a config constant once located.

### 7.9 Notification fidelity

If the tool runs as a local web app, OS-level notifications require either a browser notification API (which has known reliability issues) or a small native helper. Decide once stack is decided.

### 7.10 Scope of waypoint route planner (§5.13)

Real route planning on a 16km × 16km planet is non-trivial without map geometry. v1 may be a simple "ordered list with distances" rather than a true optimal-route solver. Worth profiling demand before investing.

### 7.11 Stale manufacturing schematic detection

Crafters who baked a manufacturing schematic six months ago have no automatic signal that its baked-in inputs are now mid-tier vs current spawns. The verdict engine already has all the data: for any user-recorded man schem, periodically score its baked inputs against current SR2 best and surface "this schematic is now N% behind a fresh bake; consider re-crafting." Defer to v2 — but flagged here so it isn't lost. Likely surfaces in a "My Manufacturing Schematics" tab parallel to "My Crates."

---

## 8. What we are not building (briefly)

- A reimplementation of Galaxy Harvester. We consume its export; we do not replace it.
- A "ghost client" that logs into the SWG server directly to read packets. The `dpwhittaker/swg-discord-bot` proves it's possible for chat; world packets are an active research project we will not pursue.
- A multi-user / cloud / shared service. One instance per player. Forever.
- A crafting tutorial or wiki. We assume the player knows SWG crafting basics; we are a decision-support tool, not an onboarding tool.
- A market-tracker / vendor scraper. Auction prices are an annotation the user enters per-comparison in the simulator; we don't index the SR2 economy.

---

## 9. Implementation stack (locked: Electron desktop)

**Decision 2026-05-10 (§7.4):** GalaxyCrafter ships as a packaged Electron desktop application — Windows primary, macOS / Linux plausible later. Inside the Electron host, the renderer stack is open (modern web frameworks are all candidates) and will be chosen in `workplan-architecture.md`. Persistent storage is local SQLite. Native OS notifications are available via Electron's notification API (§7.9 collapses into this decision). Java/JavaFX is off the table; no mobile build.

The principles in §3 still constrain remaining choices: local-first / single-user (§3.5) and fast / light / modern feel (§3.6) bias toward minimal-dependency renderer stacks and against heavy backend frameworks. Specific renderer framework, database ORM, build / packaging pipeline, auto-update mechanism, and signing / distribution model are deferred to the workplan.

---

## Sources

- [galaxyharvester.net](https://galaxyharvester.net/) — primary tracker
- [pwillworth/galaxyharvester GitHub](https://github.com/pwillworth/galaxyharvester) — open-source backend
- [GH Web Services wiki](https://github.com/pwillworth/galaxyharvester/wiki/Web-Services) — postResource, authUser, getResourceByName, markUnavailable
- [GH Data Dictionary wiki](https://github.com/pwillworth/galaxyharvester/wiki/Data-Dictionary) — schema reference
- [GH Server Best blog post](http://galaxyharvester.net/blog.py/serverbest:2016-06-27:features) — within-5% definition
- [GH Help](https://galaxyharvester.net/help.py) — quality-percentage and weighting formula
- [lewismorgan/HarvesterDroid](https://github.com/lewismorgan/HarvesterDroid) — 2017 desktop precedent
- [SWGAide](https://swgaide.com/) — older desktop precedent; Laboratory feature to verify
- [SWGAide Resource Class Info](https://swgaide.com/resources/restree.php) — caps reference
- [Lunariel's Resource Cap Guide](https://swgaide.com/lunariels_condensed_resource_guide.html) — caps reference
- [SWGEmu Wiki Experimentation Formula](https://swgemulator.fandom.com/wiki/Experimentation_Formula) — crafting math
- [SWGANH Experimentation Mechanics](http://wiki.swganh.org/index.php/Experimentation_Mechanics_(Game_Mechanics)) — crafting math
- [SWG Wiki Experimentation](https://swg.fandom.com/wiki/Experimentation) — crafting math
- [Sentinels Republic 2](https://sr2.swgsremu.com/) — target server
- [SR2Updater on GH](http://galaxyharvester.net/user.py/SR2Updater) — confirms automated SR2 → GH upload
- [dpwhittaker/swg-discord-bot](https://github.com/dpwhittaker/swg-discord-bot) — ghost-client precedent (out-of-scope reference)
