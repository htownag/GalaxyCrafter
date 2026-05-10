# reference-data/

Bundled static reference data shipped with the app. Refreshed on app version bumps via scripts in `../scripts/`.

## Files

- `galaxies.json` — Galaxy ID lookup. SR2 = 151 (resolved via brute-force scan, 2026-05-10; see `../research-notes.md` §1). Source: `galaxyharvester.net/exports/current<id>.xml`.
- `resource-types.json` — *(Phase 2)* Resource type tree with per-type stat caps and floors. Source: `resource_tree.iff` parsed via SWG-Forge `@swgemu/core` datatable parser.
- `schematics.json` — *(Phase 2)* Vanilla schematic library: ingredient slots, experimental property groups, per-stat weights, N:M parent/child references. Source: per-schematic IFF files manifested by `bin/scripts/managers/crafting/schematics.lua`.

## Provenance

Resource cap and schematic data is parsed from the vanilla Core3 codebase (`~/workspace/Core3` in WSL). Authoritative; matches SR2's actual server math (per design §9.2).
