#!/usr/bin/env node
/*
 * Walks all SR2 draft-schematic Lua files at
 *   ~/workspace/srswgemu2/MMOCoreORB/bin/scripts/object/draft_schematic/
 * For each:
 *   1. Resolve targetTemplate (path to the produced item's template Lua)
 *   2. Parse that template's experimentalMin / Max / Precision / CombineType
 *      arrays + experimentalSubGroupTitles
 *   3. Map each property by name (mindamage, maxdamage, etc.) to its range
 *
 * Outputs reference-data/schematic-experimental-ranges.json keyed by
 * schematic id (e.g. "weapon_katana") -> propertyName -> { min, max,
 * precision, combineType, inverted } where `inverted` is true when min > max
 * (lower-is-better properties like attackspeed).
 *
 * Inputs files (Lua) are plain text; we regex-parse the table fields rather
 * than embed a full Lua interpreter.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const SR2_SCRIPTS = "/home/swgemu/workspace/srswgemu2/MMOCoreORB/bin/scripts";
const DRAFT_DIR = join(SR2_SCRIPTS, "object", "draft_schematic");
const OUT_PATH =
  "/mnt/c/Users/atlee/Projects/ExtractionMod-SWGEmu/.claude/worktrees/zen-mendeleev-dc1c81/GalaxyCrafter/reference-data/schematic-experimental-ranges.json";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".lua")) out.push(full);
  }
  return out;
}

/** Regex out a simple `field = "value"` assignment. */
function getString(text, field) {
  const m = text.match(new RegExp(`${field}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

/** Regex out a `field = { ... }` table; returns the inner string. */
function getTableInner(text, field) {
  // Use a non-greedy match against the first matching `}` — these tables are
  // single-line in template Lua. If we encounter nested tables we'd need a
  // balanced parser, but experimental arrays are flat.
  const m = text.match(new RegExp(`${field}\\s*=\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

function parseStringList(inner) {
  if (!inner) return [];
  return Array.from(inner.matchAll(/"([^"]*)"/g)).map((m) => m[1]);
}

function parseNumberList(inner) {
  if (!inner) return [];
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

/** Schematic IFF path -> our app's schematic id. */
function schematicIdFromIff(iffPath) {
  // "object/draft_schematic/weapon/katana.iff" -> "weapon_katana"
  // "object/draft_schematic/weapon/component/sword_core.iff" -> "weapon_component_sword_core"
  let p = iffPath.replace(/^object\/draft_schematic\//, "");
  p = p.replace(/\.iff$/, "");
  return p.replace(/\//g, "_");
}

/** Walk + classify all draft-schematic Luas. */
const draftFiles = walk(DRAFT_DIR);
console.log(`Found ${draftFiles.length} draft-schematic Lua files.`);

const out = {};
const failures = [];
let withData = 0;
let withoutData = 0;

for (const draftPath of draftFiles) {
  const text = readFileSync(draftPath, "utf8");

  // Pull `ObjectTemplates:addTemplate(..., "object/draft_schematic/.../*.iff")`.
  // Some schematic Luas have multiple templates (one for the shared,
  // one for the server) — we want the one that maps to the iff path we care about.
  const iffMatch = text.match(
    /ObjectTemplates:addTemplate\([^,]+,\s*"(object\/draft_schematic\/[^"]+)"\)/,
  );
  if (!iffMatch) continue; // some files are abstract bases without addTemplate
  const iffPath = iffMatch[1];
  const schemId = schematicIdFromIff(iffPath);

  // Resolve targetTemplate -> the produced item's Lua. The string in
  // targetTemplate is an IFF path; the corresponding Lua path is in the
  // server's scripts/ tree at the same relative path with .lua extension.
  const targetTemplate = getString(text, "targetTemplate");
  if (!targetTemplate) {
    // Some draft schematics don't produce items directly (abstract bases);
    // skip silently.
    continue;
  }
  const targetLuaPath = join(SR2_SCRIPTS, targetTemplate).replace(/\.iff$/, ".lua");

  let templateText;
  try {
    templateText = readFileSync(targetLuaPath, "utf8");
  } catch (e) {
    failures.push({ schemId, targetLuaPath, reason: "target template Lua not found" });
    continue;
  }

  const subTitles = parseStringList(getTableInner(templateText, "experimentalSubGroupTitles"));
  const groupTitles = parseStringList(getTableInner(templateText, "experimentalGroupTitles"));
  const mins = parseNumberList(getTableInner(templateText, "experimentalMin"));
  const maxs = parseNumberList(getTableInner(templateText, "experimentalMax"));
  const precs = parseNumberList(getTableInner(templateText, "experimentalPrecision"));
  const combs = parseNumberList(getTableInner(templateText, "experimentalCombineType"));

  if (
    subTitles.length === 0 ||
    subTitles.length !== mins.length ||
    subTitles.length !== maxs.length
  ) {
    // Items without experimental properties (mostly non-craftable items).
    withoutData++;
    continue;
  }

  const propertyRanges = {};
  for (let i = 0; i < subTitles.length; i++) {
    const name = subTitles[i];
    if (name === "null" || name === "XX") continue; // sentinel for filler rows
    const min = mins[i];
    const max = maxs[i];
    propertyRanges[name] = {
      groupTitle: groupTitles[i] ?? null,
      min,
      max,
      precision: precs[i] ?? 0,
      combineType: combs[i] ?? 0,
      inverted: min > max, // lower-is-better property (attackspeed, costs)
    };
  }

  if (Object.keys(propertyRanges).length > 0) {
    out[schemId] = propertyRanges;
    withData++;
  }
}

console.log(`Extracted ranges: ${withData} schematics`);
console.log(`Skipped (no experimental data on target): ${withoutData}`);
console.log(`Failures (missing target Lua): ${failures.length}`);
if (failures.length > 0 && failures.length <= 10) {
  for (const f of failures) console.log(`  - ${f.schemId}: ${f.reason}`);
}

const payload = {
  provenance: {
    source: "sr2-template-lua-experimental-arrays",
    note: "Per-property min/max/precision/combineType extracted from each draft-schematic's targetTemplate Lua (under ~/workspace/srswgemu2/MMOCoreORB/bin/scripts/). `inverted` flag set when min > max (lower-is-better property, e.g. attackspeed, ammo costs).",
    extractedAt: new Date().toISOString(),
    schematicCount: Object.keys(out).length,
  },
  ranges: out,
};
writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
console.log(`\nWrote ${OUT_PATH}`);
console.log(`File size: ${(JSON.stringify(payload).length / 1024).toFixed(1)} KB`);
