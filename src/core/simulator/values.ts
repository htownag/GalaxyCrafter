// Weighted-value computation — §3 of docs/crafting-math.md.
//
// In Core3 (`SharedLabratory.cpp:73:getWeightedValue`), for a given stat
// index, the weighted value is the units-weighted mean of that stat across
// all filled slots:
//
//   weightedAverage = Σ (slot.stat × slot.units) / Σ slot.units
//
// Slots where stat == 0 (or where the spawn lacks that stat) skip the sum
// entirely — they don't drag the average down.

import type { StatKey } from "../../shared/ipc-types";
import type { SlotFill } from "./types";

/**
 * Units-weighted mean of `stat` across the filled slots.
 *
 * Returns 0 if no slot contributes (i.e. every slot has 0 or null for that
 * stat) — matches Core3 behaviour where `getWeightedValue` returns the
 * accumulated `weightedAverage` after the loop, which starts at 0.
 */
export function getWeightedValue(stat: StatKey, slots: SlotFill[]): number {
  let nsum = 0;
  let weightedSum = 0;
  for (const slot of slots) {
    const value = slot.stats[stat] ?? 0;
    if (value === 0) continue;
    nsum += slot.unitsRequired;
    weightedSum += value * slot.unitsRequired;
  }
  if (nsum === 0) return 0;
  return weightedSum / nsum;
}

/**
 * Build a "hypothetical perfect" slot fill — one slot with units=1 and
 * every stat at the perfect-resource ceiling (1000). Used by the v1
 * simulator to project the schematic's ceiling without needing real
 * resources. Future versions will read real (resource, slot) pairs.
 */
export function hypotheticalPerfectFill(unitsRequired = 1): SlotFill {
  return {
    unitsRequired,
    stats: {
      CR: 1000,
      CD: 1000,
      DR: 1000,
      HR: 1000,
      FL: 1000,
      MA: 1000,
      PE: 1000,
      OQ: 1000,
      SR: 1000,
      UT: 1000,
    },
  };
}
