#!/usr/bin/env node
/*
 * Discovery script — read one draft-schematic IFF from SR2's TRE via
 * SWG-Forge + raw file extraction, then dump its IFF tree so we can
 * identify which chunk carries experimentalMin / experimentalMax /
 * experimentalPrecision / experimentalCombineType.
 */

import { openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const SWG_FORGE = "/home/swgemu/workspace/SWG-Forge";
const TRE_DIR = "/tre";

const { parseTRE } = await import(
  join(SWG_FORGE, "packages/tre-viewer/out/treReader.js")
);
const { parseIFF, getTreeStructure } = await import(
  join(SWG_FORGE, "packages/core/out/iff.js")
);

/** Extract raw bytes for one file inside a TRE. Handles zlib compression. */
function extractFromTRE(trePath, entry) {
  const fd = openSync(trePath, "r");
  try {
    const buf = Buffer.alloc(entry.compressedSize);
    readSync(fd, buf, 0, entry.compressedSize, entry.fileOffset);
    if (entry.compressionType === 2) {
      return inflateSync(buf);
    }
    return buf;
  } finally {
    closeSync(fd);
  }
}

const TARGET_TRE = process.argv[2] ?? "data_other_00.tre";
const TARGET_NAME = process.argv[3] ?? "weapon_katana";

const trePath = join(TRE_DIR, TARGET_TRE);
const tre = parseTRE(trePath);
const entries = tre.files ?? [];

const candidates = entries.filter((e) =>
  /draft_schematic.*weapon/i.test(e.path),
);
console.log(`Weapon draft schematics in ${TARGET_TRE}: ${candidates.length}`);

const target = candidates.find((e) => e.path.includes(TARGET_NAME))
  ?? candidates[0];
if (!target) {
  console.log("No target found.");
  process.exit(1);
}
console.log(`\n=== Target: ${target.path} ===`);
console.log(`  compressedSize: ${target.compressedSize}, uncompressedSize: ${target.uncompressedSize}, compType: ${target.compressionType}`);

const raw = extractFromTRE(trePath, target);
console.log(`  extracted bytes: ${raw.length}`);

// First 32 bytes as hex to see the IFF header
console.log(`  first 32 bytes hex: ${raw.slice(0, 32).toString("hex")}`);
console.log(`  first 8 bytes ascii: ${raw.slice(0, 8).toString("ascii")}`);

const iff = parseIFF(raw);
const tree = getTreeStructure(iff);
console.log("\n=== IFF tree structure ===");
console.log(JSON.stringify(tree, null, 2).slice(0, 8000));
