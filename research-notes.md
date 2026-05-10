# GalaxyCrafter — Pre-Phase-1 Research Notes

**Date:** 2026-05-10
**Scope:** Resolves workplan §6.1, §6.2, §6.3 (pre-Phase-1 action items).
**Open:** workplan §6.4 (pre-Phase-6 Core3 crafting math audit) — deferred to just before Phase 6 starts.

Section ordering mirrors the workplan.

---

## 1. SR2 galaxy ID (§6.1) — RESOLVED

**SR2 = 151.** Confirmed by brute-force ID scan against `galaxyharvester.net/exports/current<N>.xml` for N ∈ [1, 200] and grepping the first 800 bytes of each response for `Sentinels Republic 2`.

Sibling result: `SR Alderaan = 72` (a separate SR server, not relevant to this project but worth recording so we don't accidentally pull the wrong galaxy).

**Endpoints (verified):**
- `https://galaxyharvester.net/exports/current151.xml` → 200 OK, ~178 KB, 484 currently-spawning resources, freshness `as_of_date="Sun, 10 May 2026 00:00:09 -0800"` (refreshed daily at GH's 5pm UTC job).
- `https://galaxyharvester.net/exports/all151.xml` → **404 Not Found**. See §7 below — this changes Phase 1's historical-archive plan.

Storage convention for the app: `reference-data/galaxies.json`:
```json
{ "sr2": 151, "sr_alderaan": 72 }
```

---

## 2. GH XML format (§6.3) — AUDITED

Pulled `current151.xml` (Sun 10 May 2026 snapshot) and inspected.

### Structure

```xml
<?xml version="1.0" encoding="iso-8859-15"?>
<resources as_of_date="Sun, 10 May 2026 00:00:09 -0800">
  <resource>
    <name>aewauian</name>
    <galaxy id="151">Sentinels Republic 2</galaxy>
    <enter_date>Thu, 30 Apr 2026 03:09:54 -0800</enter_date>
    <resource_type id="iron_axidite">Axidite Iron</resource_type>
    <group_id>iron</group_id>
    <stats>
      <CR>179</CR><CD>155</CD><DR>583</DR>
      <HR>629</HR><MA>142</MA><OQ>990</OQ>
      <SR>543</SR><UT>582</UT>
    </stats>
    <planets>
      <planet>Dathomir</planet>
      <planet>Lok</planet>
      <planet>Tatooine</planet>
    </planets>
  </resource>
  …
</resources>
```

### Key observations

- **Encoding:** ISO-8859-15. `fast-xml-parser` (workplan-locked) handles this; ensure ingest reads bytes-then-decode explicitly rather than assuming UTF-8.
- **Resource type slug:** `<resource_type id="iron_axidite">` — this is the slug we join against `resource_types.id` in our schema. Display name (`Axidite Iron`) is the body text.
- **Group slug:** `<group_id>iron</group_id>` — coarser category. Useful for filtering.
- **Variable stat subsets per resource type.** This is the most important format quirk: each resource only has stat tags for the attributes that apply to its *type*. Iron has 8 stats (CR, CD, DR, HR, MA, OQ, SR, UT). A gemstone in the same file has different 8 (e.g. `armophous_baltaran` has CR, DR, HR, MA, OQ, SR, UT, ER — note ER instead of CD). Foods get FL (Flavor), fuels get PE (Potential Energy). Total possible: 11. Missing tag ≠ value of 0 — it's "stat does not apply to this resource type."
  - **Schema implication (already correct):** stat columns on `resources` are nullable INTEGERs. Missing in XML = NULL in DB.
  - **Verdict engine implication:** when a schematic weight references a stat the resource doesn't have, contribution = 0 (not error). Normalisation divides by the sum of weights for stats the resource actually has, OR we treat absent-stat as automatic disqualification depending on the slot's accepted-type rules. **Workplan §5.2 to revisit during Phase 3.**
- **Multi-planet support** confirmed: `<planets>` is a list. Our `resource_planets` join table is right.
- **Date format:** RFC-style strings (e.g. `Thu, 30 Apr 2026 03:09:54 -0800`). Parse to unix ms during ingest.
- **No despawn date** in the export. We compute despawn estimate from `enter_date + type.typical_lifetime`. Type lifetime data must come from elsewhere — workplan §5.12 already noted estimates are fuzzy; this is the source of the fuzziness.
- **No waypoints in the export.** Confirmed by section absence on the resources audited. Waypoint data lives in GH's database under `tWaypoint` but isn't included in the daily XML export. **Workplan implication:** the §5.13 waypoint pass-through display either needs a separate GH endpoint (none documented) or is deferred to v2.
- **No `<availability>` flag** explicitly present in the export — every resource in `current151.xml` is by definition currently available. (When a resource despawns, it's removed from `current<id>.xml` in the next refresh; absence-from-current is the despawn signal.) Workplan schema `resource_observations.available` becomes "did this resource appear in this snapshot": `true` = present, `false` = absent in this snapshot but seen in a prior one. Simpler model than originally drafted.

### Size and parse cost
- 178 KB raw, 484 `<resource>` entries. ~370 bytes per resource on average.
- Parse to typed objects with fast-xml-parser: trivially sub-second.

### Conclusion

The XML format is clean, well-formed, predictable. Phase 1 parser is straightforward. Schema implications noted inline.

---

## 3. Core3 resource cap source (§6.2 — resource caps) — LOCATED

**Caps live in `resource_tree.iff`, parsed by `ResourceTree.cpp`.**

### C++ parser files

`~/workspace/Core3/MMOCoreORB/src/server/zone/managers/resource/resourcespawner/resourcetree/`:

- `ResourceTree.cpp` (261 lines) — loads `resource_tree.iff`, builds the in-memory tree, exposes lookup APIs. `setZoneRestriction()` at line 142 is the routine the extraction-mod project's D9 work already touched (substring match `name.indexOf("_" + zonename)`).
- `ResourceTree.h`
- `ResourceTreeEntry.h` — per-leaf entry definition
- `ResourceTreeNode.cpp` / `.h` — internal-node definitions
- `ResourceAttribute.h` — stat attribute definitions

These are the reference for understanding the IFF column layout but **we don't need to port the C++**. We parse the IFF directly.

### Data file: `resource_tree.iff`

- 51 columns × 725 rows (per `docs/knowledge-base/INDEX.yaml` finding from 2026-04-27)
- 207,321 bytes uncompressed
- Lives in client TRE: latest is in `patch_14_00.tre` per KB note
- **Already extracted in this project** at:
  ```
  C:/Users/atlee/Projects/ExtractionMod-SWGEmu/research/resource-tree-vanilla/resource_tree.iff
  C:/Users/atlee/Projects/ExtractionMod-SWGEmu/research/resource-tree-vanilla/tython-row-data.md
  ```
  (Currently in main project, not in this worktree — copy into the GalaxyCrafter repo when Phase 1 starts, or symlink at runtime.)

### Parser tooling

Per `docs/knowledge-base/swg-forge-claude-cli.md`, the SWG-Forge `@swgemu/core` library exposes a datatable parser. INDEX.yaml records that `serializeDatatable` write-back is NOT round-trip-validated (per 2026-04-27 finding), but **read parsing IS validated** on `resource_tree.iff` specifically (51 cols / 725 rows / sane values). Read-only consumption is exactly what GalaxyCrafter needs — write-back is not required for caps.

`scripts/import-core3-caps.ts` (workplan Phase 2) will:
1. Read `resource_tree.iff` via SWG-Forge datatable parser (Node-callable).
2. Map the 51 columns to: `id (slug)`, `parent_id`, `group_id`, 11 stat caps, 11 stat floors, classification metadata.
3. Output `reference-data/resource-types.json`.

The 51 columns include cap min and cap max for each of the 11 stats (so 22 of the columns), plus parent/child tree pointers, naming, and classification tags. Exact column→attribute mapping is best derived by reading `ResourceTree.cpp` alongside the IFF in SWG-Forge's tree-viewer.

---

## 4. Core3 schematic source (§6.2 — schematics) — LOCATED

**Schematics live in IFF files in the client TRE, manifested by `schematics.lua`.**

### Manifest file

`~/workspace/Core3/MMOCoreORB/bin/scripts/managers/crafting/schematics.lua` — 1,827 lines. Each entry is a single-line path:

```lua
schematics = {
  {path="object/draft_schematic/community_crafting/component/connections.iff"},
  {path="object/draft_schematic/community_crafting/component/endrost.iff"},
  …
  {path="object/draft_schematic/weapon/pistol_blaster_cdef.iff"},
  …
}
```

The Lua is a manifest — it tells the server which IFFs to load. The actual schematic *data* (ingredient slots, experimental property groups, per-stat weights, sub-component references) lives inside the IFF files.

### IFF locations (in client TRE)

Categories observed in the first 200 lines:
- `object/draft_schematic/community_crafting/component/…` — sub-component schematics (Connections, Endrost, Power Supply, Primary Computer, Regulator, Shield Housing, Unit Computer, Refined Ardanium II / Rudic / Endrine, Reinforced Wall Module, Lightweight Turret variants…). These are exactly the N:M sub-components the dependency-graph schema models.
- `object/draft_schematic/armor/…` — armor schematics and armor sub-segments (`armor_segment`, `armor_segment_chitin`, `armor_segment_composite`, etc. — these are sub-components that feed armor pieces).
- `object/draft_schematic/clothing/…` — clothing variants (incl. armor-as-clothing pieces, e.g. `clothing_armor_composite_*`).
- `object/draft_schematic/item/…` — survey tools, crafting tools, utility items, dice.
- `object/draft_schematic/weapon/…` — full weapons (e.g. `pistol_blaster_cdef.iff` was visible by line ~150).
- Many more categories exist below the first 200 lines (file is 1,827 lines).

### Parser tooling

SWG-Forge `@swgemu/core` exposes IFF parsing. The `swg-forge-claude-cli.md` KB doc covers the usage; existing extraction-mod tooling at `scripts/extract-ws-spawns.js` is a precedent for Node-driven IFF processing.

`scripts/import-core3-schematics.ts` (workplan Phase 2) will:
1. Read the manifest list from `schematics.lua` (simple regex/Lua-table parse).
2. For each IFF path, locate the IFF in the client TRE.
3. Parse the IFF with SWG-Forge to extract: schematic name, profession (encoded in IFF), ingredient slots (slot name, accepted resource type family OR accepted sub-component schematic id, units required), experimental property groups (property name, per-stat weight 0.0-1.0).
4. Build parent → child schematic dependency edges by inspecting which schematics' slots accept other schematics' outputs.
5. Output `reference-data/schematics.json`.

### Estimated coverage

1,827 schematics in vanilla Core3. Ryan's Weaponsmith + Artisan scope is ~30-50 of these (full weapons + sub-components + a few raw-resource components). Coverage is far beyond what the v1 verdict engine needs.

### Companion crafting Lua files

Also in `bin/scripts/managers/crafting/`:
- `bio_dna_sets.lua` — Bio-Engineer DNA experimentation tables (out of scope for v1; Bio-Engineer is not in priority professions).
- `bio_skill_mods.lua` — Bio-Engineer skill mod data (same).
- `visible_components.lua` — visible-component crafting (cosmetic appearance overlays on armor/weapons; not v1 verdict-engine territory).

---

## 5. Resource manager runtime config (incidental) — LOCATED

`~/workspace/Core3/MMOCoreORB/bin/scripts/managers/resource_manager.lua` — runtime configuration. Notable values for context:

- `activeZones = "corellia,tatooine,lok,naboo,rori,endor,talus,yavin4,dathomir,dantooine,tython"`
  → 11 planets. **`tython` is included.** Tython is the extraction-mod project's custom planet; vanilla SR2 does NOT include it. SR2 server config may differ — confirm by reading SR2's `config-local.lua` if needed during Phase 1 testing. For our purposes, the planet name appears in `current151.xml` `<planet>` tags so we just consume whatever the export says.
- `averageShiftTime = 7200000` ms (2h) — how often the resource manager schedules itself.
- `aveduration = 86400` s (1d) — base for resource lifetime ranges: Organics in shift between 6d–22d, Inorganics 6d–11d, JTL 13d–22d.
- `spawnThrottling = 90` — 90% of resource stats spawn below 90% of cap; 10% above. Useful context for verdict thresholds (a 95+% resource is genuinely rare, ~10% of new spawns).

`~/workspace/Core3/MMOCoreORB/bin/scripts/managers/resource_manager_spawns.lua` — 333,994 lines. **Not relevant to GalaxyCrafter.** This is the seed file used to populate an *empty* server's resource database on first boot. Once the server runs, actual spawns live in ODB persistence and this file is no longer consulted. Our app pulls live spawns from GH, not from this file.

---

## 6. Pre-Phase-6 audit targets (§6.4) — deferred but recorded

When Phase 6 (crafting simulator) starts, the Core3 actual-math audit pulls from:

- `~/workspace/Core3/MMOCoreORB/src/server/zone/managers/resource/`:
  - `ResourceManager.idl`
  - `ResourceManagerImplementation.cpp`
  - `resourcespawner/ResourceSpawner.cpp`
- `~/workspace/Core3/MMOCoreORB/src/server/zone/managers/crafting/` (path inferred; verify when the time comes).
- Anywhere in C++ that implements assembly success roll, experimentation roll, and the multi-property compensation factor that wiki sources describe but don't numerically specify.

Recording here so future-Claude / Ryan-in-three-months doesn't waste time re-locating these.

---

## 7. Findings that change the workplan

Two items surfaced during this research that materially affect the workplan and need it amended.

### 7.1 `all<galaxyId>.xml` is NOT publicly available

`https://galaxyharvester.net/exports/all151.xml` returns **404**. Same for `all73.xml` and `all1.xml`. GH's public-no-auth export endpoint is `current<id>.xml` only — the historical archive mentioned in the GH source's `resourceDump.py` is either generated only on demand, login-gated, or no longer served.

**Workplan impact:** the original Phase 1 plan was to pull both feeds and use the historical archive to seed Phase 4 inventory autocomplete (so resources Ryan harvested before installing the app are still searchable by name). That plan needs revision.

**Alternative approaches (pick during workplan update):**

1. **Self-accumulated history.** From Phase 1 onward, every `current151.xml` ingest appends to a `resources_seen` table (UPSERT on resource id; never delete). Over weeks, this builds our own local history. Phase 4 autocomplete searches this table. Cost: app must run for a few weeks before the search corpus is useful; first-day inventory entry still requires manual stat typing for old resources.
2. **Manual stat entry with type-aware defaults.** When adding an unknown resource, autocomplete just the resource *type* (from `reference-data/resource-types.json`); user enters the 11 stats by hand. Show cap/floor hints alongside each input. Cost: tedious for the first inventory pass but every tool in the genre requires this for old resources; HD and SWGAide have it too.
3. **GH authenticated session.** Implement `authUser` + cookie reuse and try `all<id>.xml` from an authenticated session (per `postResource` API doc, `gh_sid` opens up other endpoints). Cost: auth flow against a third-party site, fragile against GH changes. Worth probing once during Phase 1 (~30 min) but not relying on.
4. **Ryan ad-hoc export.** Per GH help, the `all<id>.xml` *is* mentioned to users; possibly available via the logged-in "Other Links" box on the home page. If so, Ryan can download once, drop into our app's `reference-data/`, done. Worth checking next time Ryan is in GH.

Recommendation: **(1) + (2) + (4) combined.** (1) starts working from day one, (2) covers immediate inventory entry, (4) makes the historical search instantly useful if Ryan can grab the file once. (3) skip unless (4) doesn't pan out.

### 7.2 Waypoint data isn't in the daily export

No `<waypoint>` tags in the `current151.xml` audit. Workplan §5.13 (waypoint passes through from GH) needs:

- Either a separate GH endpoint for waypoints (none documented; would need source-code investigation).
- Or accept that v1 ships without GH-sourced waypoints; user adds their own waypoints locally via §5.13's "Personal waypoint additions" path.

Recommendation: v1 ships local-waypoints-only. Defer "import GH waypoints" to v2 alongside the auth-session piece.

### 7.3 Custom planet `tython` is in active zones

`resource_manager.lua` lists `tython` among the 11 active zones — but that's the extraction-mod project's custom planet, not vanilla. SR2's deployed config may or may not include Tython. For GalaxyCrafter v1 (vanilla schematics only, per design §7.3 decision), this doesn't matter because:
- Resource type slugs in `current151.xml` are vanilla (`iron_axidite`, `armophous_baltaran`, etc.).
- Planet names in `<planet>` tags use the slug strings; if SR2 ever exports a `tython` spawn we just render the name as-is.

No workplan change needed. Just record that the planet list is data-driven from the export, not hard-coded.

### 7.4 `resource_tree.iff` not yet in the worktree

The extracted file is in main project at `research/resource-tree-vanilla/resource_tree.iff` but the current worktree only has `research/README.md`. Not blocking; just a note that when Phase 1 begins (and especially when `scripts/import-core3-caps.ts` is written), the IFF needs to be accessible — either copy it into GalaxyCrafter's reference area or symlink/path-reference into the main project.

---

## 8. Summary

- §6.1 (SR2 galaxy ID): **151** — recorded.
- §6.2 (Core3 source paths for caps + schematics): **located** — `resource_tree.iff` + `ResourceTree.cpp` for caps; `schematics.lua` manifest + per-schematic IFFs for schematics; SWG-Forge handles both parses.
- §6.3 (GH XML audit): **format confirmed**; one schema clarification (variable stat subsets per type), four findings that change the workplan (no `all<id>.xml`, no waypoints in export, tython in active zones, IFF copy needed).
- §6.4 (Core3 crafting math): targets recorded; **deferred** to pre-Phase-6.

Workplan updates to apply next:
1. §6.1 → record galaxy ID 151.
2. Phase 1 ingest → drop `all<id>.xml` fetch (it's 404); replace with self-accumulating history table.
3. Phase 4 inventory → revise autocomplete plan per §7.1 above (self-history + manual + optional auth-session probe).
4. §5.13 waypoint feature → mark "local-only in v1; GH waypoint import deferred."

These edits are minor and follow this note in sequence.

---

## 9. Pre-Phase-2 data source pivot (2026-05-10)

**Decision: use GH seedData files for resource caps + schematics, NOT raw Core3 IFF parsing via SWG-Forge.**

This is a deliberate change from workplan §9.2 plan A (Core3 Lua + IFF). Recorded here so future-Claude / future-Ryan sees the silent decision and can audit it.

### What GH ships as seedData

The `pwillworth/galaxyharvester` GitHub repo commits five TSV files at `database/seedData/`, derived by the GH team from Core3 IFFs around 2017 (initial) and 2019 (last refresh, "import from publish9 branch"):

| File | Rows | Purpose |
|------|-----:|---------|
| `tResourceType.txt` | ~700 | Per-type stat caps + floors: 22 numeric columns = 11 stats × (min, max). `0,0` pair = stat doesn't apply to type. |
| `tSchematic.txt` | 1,710 | Schematic master: `schematicID`, name, skill group, crafting tab, complexity, object path, parent object path. |
| `tSchematicIngredients.txt` | 7,516 | Ingredient slots: schematic FK + slot name + type (0=raw / 1,3=component) + ingredient (resource family for raw, IFF path for component) + units required. |
| `tSchematicQualities.txt` | 13,372 | Property groups: auto `expQualityID` + schematic FK + property name + exp group (`expDamage` etc) + weight total. |
| `tSchematicResWeights.txt` | 9,005 | Per-stat weights: `expQualityID` FK + stat code + weight (1–5). |

All four schematic tables join cleanly. Walked T21 Rifle (`weapon_rifle_t21`) end-to-end: 8 ingredient slots (5 raw, 2 components, 1 optional component), 15 quality groups (5 valid `expDamage`, 4 `expEffeciency`, 1 `exp_durability`, 1 `expRange`, 4 null/derived), per-stat weights resolved.

### Coverage audit

- **1,710 GH schematics vs 1,778 in Core3's `schematics.lua` manifest = 96.2%.** 68-schematic gap. Likely 2020+ additions Core3 made after publish9; vanilla Weaponsmith / Armorsmith / Architect / Chef / Tailor scope is intact.
- **T21 Rifle present** (workplan exit criteria; "T21 Heavy Carbine" in workplan was a naming slip — the schematic is classified as Rifle in-game).
- **Weaponsmith priority schematics confirmed present:** all major carbines (CDEF, DH17, DH17 Short, E11, EE3, Elite, Laser, DXR-6), all major pistols (CDEF, D18, DH17, DL44, DL44 Metal, Power5), barrels + cores + sub-components.
- **Resource types:** `tResourceType.txt` covers vanilla resource tree; the 96.2% coverage applies to schematics, not resource types.

### Staleness

Last touched 2019-04-20 ("Schematic data update based on import from publish9 branch"). SWG vanilla crafting mechanics have been frozen since SOE shut down in 2011, so the 2019 snapshot of vanilla-Core3 schematic data is still accurate for vanilla servers. Risk only applies to:

- Servers that added custom schematics since publish9 (SR2 may have some; design §7.3 explicitly defers SR2 customs to post-v1, so this risk is bounded).
- Servers that tweaked weights on existing schematics (the §6.4 audit will catch this — see addendum to workplan).

### Why not raw Core3 IFF parsing (plan A)

SWG-Forge `@swgemu/core` is read-validated for `resource_tree.iff` (per KB) but the draft-schematic IFF format has chunks not yet built into the SWG-Forge crafting-workshop package as of this audit. Writing a complete IFF→JSON parser for draft schematics would have taken multiple days of chunk-format reverse engineering (FORM DSCH structure isn't formally documented in @swgemu/core's published surface). GH seedData is functionally the same data, pre-parsed and tested by GH's production.

If GH seedData turns out to have weight drift vs current Core3 (the §6.4 audit will catch this pre-Phase-6), the recovery is: write `scripts/import-core3-iffs.ts` to produce the same canonical `reference-data/schematics.json` shape. Architecture is decoupled from source via the JSON intermediate.

### Workplan amendments applied

- **§6.2 (Locate Core3 paths):** updated — primary source for v1 is GH seedData; Core3 IFFs are the swap-in if the audit fails.
- **§6.4 (Pre-Phase-6 audit):** expanded — now also compares a sample of GH seedData property weights against current Core3 IFF schematics before locking simulator predictions. Adds ~30 min to that future audit; prevents a class of subtle "right math + wrong weights" failures.
- **Phase 2 importer:** renamed from `import-core3-schematics.ts` to `import-gh-seedata.ts`. One producer; emits canonical `reference-data/schematics.json` + `resource-types.json`. Future Core3-IFF-based importer would produce the same JSON shape, swap-in only.

### TL;DR

Pragmatic shortcut. Saves multiple days of IFF-parsing work. Coverage + freshness audited and acceptable. Pre-Phase-6 audit catches the only realistic failure mode (weight drift) before it can corrupt simulator predictions. Architecture preserves the option to switch sources later via one-file replacement.
