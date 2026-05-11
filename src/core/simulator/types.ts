// Shared types for the crafting simulator. Phase 6 v1 — scope is the 5
// ResourceLabratory professions (Artisan, Weaponsmith, Armorsmith, Architect,
// Chef). All formulas mirror docs/crafting-math.md which is verified against
// Core3 source.

import type { StatKey } from "../../shared/ipc-types";

/**
 * Tier enum mirroring `CraftingManager` constants in Core3.
 * Numeric values match the Core3 enum (used by calculateAssemblyValueModifier).
 */
export const ASSEMBLY_TIER = {
  AMAZINGSUCCESS: 0,
  GREATSUCCESS: 1,
  GOODSUCCESS: 2,
  MODERATESUCCESS: 3,
  SUCCESS: 4,
  MARGINALSUCCESS: 5,
  OK: 6,
  BARELYSUCCESSFUL: 7,
  CRITICALFAILURE: 8,
} as const;

export type AssemblyTier = (typeof ASSEMBLY_TIER)[keyof typeof ASSEMBLY_TIER];

/** A single resource on a property-group weight row. */
export interface WeightEntry {
  stat: StatKey;
  /** Raw integer weight (1..5) as stored in `schematic_property_weights`. */
  weight: number;
}

/** A schematic's property group as the simulator sees it. */
export interface PropertyGroupInput {
  id: number;
  propertyName: string | null; // e.g. 'mindamage'; null for non-experimental
  expGroup: string | null; // e.g. 'expDamage'
  weights: WeightEntry[];
  /** Final-value range from SR2 template Lua. Null when not available
   *  (non-experimental groups, or experimental data not joined for this id). */
  expMin?: number | null;
  expMax?: number | null;
  /** Decimal places to display (e.g. attackspeed wants 1, mindamage wants 0). */
  expPrecision?: number | null;
  /** True when min > max — lower is better (attackspeed, attack costs). */
  inverted?: boolean | null;
}

/**
 * Pure resource-stats vector used by the simulator. Same shape as the verdict
 * engine's ResourceStats, repeated here so simulator code doesn't reach into
 * verdict types. ER intentionally absent — Core3's crafting enum doesn't
 * weight ER, ever (see crafting-math.md §3 callout).
 */
export interface ResourceStatsVector {
  CR: number | null;
  CD: number | null;
  DR: number | null;
  HR: number | null;
  FL: number | null;
  MA: number | null;
  PE: number | null;
  OQ: number | null;
  SR: number | null;
  UT: number | null;
}

/**
 * A "slot fill" the simulator scores against — typically one entry per raw
 * resource slot on the schematic. For v1 we accept either a real resource's
 * stats OR a hypothetical (e.g. "1000 across the board" for ceiling reads).
 */
export interface SlotFill {
  /** Number of units this slot consumes (from `schematic_slots.unitsRequired`). */
  unitsRequired: number;
  /** Stats of whatever is filling the slot. */
  stats: ResourceStatsVector;
}

/** Skill profile that drives starting% scaling + experimentation gain budget. */
export interface SkillProfile {
  /** 0..120. Master crafter = 110-120. Drives assembly outcome tier. */
  assemblySkill: number;
  /** 0..120. Drives experimentation point budget = expSkill / 10. */
  experimentationSkill: number;
  /** Tool effectiveness (-15..15). +15 = best private tool. */
  toolEffectiveness: number;
}

/** Sensible default profile for a fully-skilled crafter with a private tool. */
export const DEFAULT_SKILL_PROFILE: SkillProfile = {
  assemblySkill: 110,
  experimentationSkill: 110,
  toolEffectiveness: 15,
};

/** Per-property-group prediction the simulator returns to the UI. */
export interface PredictedPropertyGroup {
  id: number;
  propertyName: string | null;
  expGroup: string | null;
  weights: WeightEntry[];

  /** Sum of (stat × percentage) across weight rows, 0..1000. */
  weightedSum: number;
  /** weightedSum / 1000 × 100, the max-attainable percentage on this group. */
  maxPercent: number;
  /**
   * Starting percentage right after assembly (pre-experimentation). Computed
   * with the assumed assembly tier (default: GREATSUCCESS, modifier 1.0).
   */
  startingPercent: number;
  /**
   * Final percentage if the player dumped ALL experimentation points on
   * this one group at GREATSUCCESS per press. Clamped to maxPercent.
   * The ceiling for "what this row can be."
   */
  focusedPercent: number;

  // Final-value projections (in real in-game units), driven by the SR2
  // template Lua's experimentalMin/Max. Null when no range was joined.
  /** The schematic's value range for this property, lowest to highest as
   *  authored (inverted=true means min > max). */
  expMin: number | null;
  expMax: number | null;
  expPrecision: number | null;
  inverted: boolean | null;
  /** Real-world value of this property when the percentage = startingPercent. */
  startingValue: number | null;
  /** Real-world value at focusedPercent (ceiling-if-focused). */
  focusedValue: number | null;
}

export interface PredictManufactureInput {
  /** Schematic id to predict against. */
  schematicId: string;
  /**
   * v1 stub: "hypothetical_perfect" assumes every stat at 1000 in every
   * filled slot — the simulator returns the schematic's ceiling. Future
   * versions accept per-slot resource ids from inventory / current spawns.
   */
  slotConfig: "hypothetical_perfect";
  /** Optional override of the default master-crafter profile. */
  skillProfile?: SkillProfile;
  /** Optional override of the assumed assembly tier. Defaults to GREATSUCCESS. */
  assemblyTier?: AssemblyTier;
}

export interface PredictManufactureResult {
  schematic: {
    id: string;
    name: string;
    profession: string | null;
  };
  /** What slot-fill assumption the prediction used (UI surfaces this). */
  slotConfig: "hypothetical_perfect";
  /** Echoes the assumed skill profile + assembly tier back to the UI. */
  assumptions: {
    skillProfile: SkillProfile;
    assemblyTier: AssemblyTier;
    experimentationPointBudget: number;
  };
  propertyGroups: PredictedPropertyGroup[];
}
