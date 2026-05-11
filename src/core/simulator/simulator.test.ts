// Simulator unit tests — pin formulas against docs/crafting-math.md sample
// tables. If these break, the docs and the code disagree; one of them is wrong.

import { describe, expect, it } from "vitest";
import { calculateAssemblyValueModifier, getAssemblyPercentage } from "./assembly";
import {
  applyExperimentPress,
  experimentationValueModifier,
  focusedExperimentation,
} from "./experiment";
import { predictSchematic } from "./manufacture";
import { ASSEMBLY_TIER } from "./types";
import { getWeightedValue, hypotheticalPerfectFill } from "./values";

describe("getAssemblyPercentage — §4 sample table", () => {
  // Verbatim from docs/crafting-math.md §4. Verified against
  // SharedLabratory.cpp:68 with formula
  //   percentage = (value × (0.000015 × value + 0.015)) × 0.01
  // Returns a decimal (0..1), not a percentage, so 30% = 0.30.
  it("matches 100 → 1.65%", () => {
    expect(getAssemblyPercentage(100)).toBeCloseTo(0.0165);
  });
  it("matches 500 → 11.25%", () => {
    expect(getAssemblyPercentage(500)).toBeCloseTo(0.1125);
  });
  it("matches 700 → 17.85%", () => {
    expect(getAssemblyPercentage(700)).toBeCloseTo(0.1785);
  });
  it("matches 900 → 25.65% (doc §4 table had a typo of 26.55, formula gives 25.65)", () => {
    expect(getAssemblyPercentage(900)).toBeCloseTo(0.2565);
  });
  it("matches 940 → 27.35%", () => {
    expect(getAssemblyPercentage(940)).toBeCloseTo(0.2735, 4);
  });
  it("matches 1000 → 30.00%", () => {
    expect(getAssemblyPercentage(1000)).toBeCloseTo(0.3);
  });
});

describe("calculateAssemblyValueModifier", () => {
  it("AMAZINGSUCCESS → 1.05", () => {
    expect(calculateAssemblyValueModifier(ASSEMBLY_TIER.AMAZINGSUCCESS)).toBe(1.05);
  });
  it("GREATSUCCESS → 1.00", () => {
    expect(calculateAssemblyValueModifier(ASSEMBLY_TIER.GREATSUCCESS)).toBeCloseTo(1);
  });
  it("GOODSUCCESS → 0.90", () => {
    expect(calculateAssemblyValueModifier(ASSEMBLY_TIER.GOODSUCCESS)).toBeCloseTo(0.9);
  });
  it("BARELYSUCCESSFUL → 0.40", () => {
    expect(calculateAssemblyValueModifier(ASSEMBLY_TIER.BARELYSUCCESSFUL)).toBeCloseTo(0.4);
  });
});

describe("experimentationValueModifier — §5c table", () => {
  it("GREATSUCCESS × 3 points → +0.21", () => {
    expect(experimentationValueModifier(ASSEMBLY_TIER.GREATSUCCESS, 3)).toBeCloseTo(0.21);
  });
  it("BARELYSUCCESSFUL × 3 points → -0.21", () => {
    expect(
      experimentationValueModifier(ASSEMBLY_TIER.BARELYSUCCESSFUL, 3),
    ).toBeCloseTo(-0.21);
  });
  it("AMAZINGSUCCESS × 11 points → +0.88", () => {
    expect(experimentationValueModifier(ASSEMBLY_TIER.AMAZINGSUCCESS, 11)).toBeCloseTo(0.88);
  });
  it("MARGINALSUCCESS → 0 regardless of points", () => {
    expect(experimentationValueModifier(ASSEMBLY_TIER.MARGINALSUCCESS, 11)).toBe(0);
  });
});

describe("applyExperimentPress — bounded behaviour", () => {
  it("clamps to maxPercent on overshoot", () => {
    const result = applyExperimentPress(0.9, 0.94, ASSEMBLY_TIER.GREATSUCCESS, 3);
    expect(result).toBeCloseTo(0.94);
  });
  it("clamps to 0 on underflow (critical fail at low %)", () => {
    const result = applyExperimentPress(0.05, 1.0, ASSEMBLY_TIER.CRITICALFAILURE, 1);
    expect(result).toBe(0);
  });
  it("applies normal modifier within bounds", () => {
    const result = applyExperimentPress(0.4, 0.94, ASSEMBLY_TIER.GREATSUCCESS, 2);
    expect(result).toBeCloseTo(0.54);
  });
});

describe("focusedExperimentation — dump all points one row", () => {
  it("perfect-resource set hits the cap (1000 weightedSum)", () => {
    // §4 sample: 1000 → starting% 30, maxPct 100. With 11 points GREATSUCCESS:
    //   final = 30 + 11 × 7 = 30 + 77 = 107 → clamped to 100.
    const result = focusedExperimentation(0.3, 1.0, 11);
    expect(result).toBeCloseTo(1.0);
  });
  it("940 weightedSum with budget=11 caps at 0.94", () => {
    // §4: starting 27.35%, max 94%. Pressing 11 points GREATSUCCESS adds 77pp.
    //   27.35 + 77 = 104.35 → clamped to 94.
    const result = focusedExperimentation(0.2735, 0.94, 11);
    expect(result).toBeCloseTo(0.94);
  });
  it("low-skill (3 points) doesn't reach cap on 940-sum row", () => {
    // 3 points GS = +21. start 27.35 + 21 = 48.35. cap 94 not reached.
    const result = focusedExperimentation(0.2735, 0.94, 3);
    expect(result).toBeCloseTo(0.4835);
  });
});

describe("getWeightedValue — §3 units-weighted mean", () => {
  it("returns 0 on empty slots", () => {
    expect(getWeightedValue("MA", [])).toBe(0);
  });

  it("ignores slots where stat is null or 0", () => {
    const slots = [
      { unitsRequired: 5, stats: { ...hypotheticalPerfectFill().stats, MA: null } },
      { unitsRequired: 3, stats: { ...hypotheticalPerfectFill().stats, MA: 0 } },
      { unitsRequired: 2, stats: { ...hypotheticalPerfectFill().stats, MA: 500 } },
    ];
    // Only the last slot contributes. Weighted mean = 500 × 2 / 2 = 500.
    expect(getWeightedValue("MA", slots)).toBe(500);
  });

  it("computes units-weighted mean across multiple contributing slots", () => {
    const slots = [
      { unitsRequired: 10, stats: { ...hypotheticalPerfectFill().stats, OQ: 800 } },
      { unitsRequired: 5, stats: { ...hypotheticalPerfectFill().stats, OQ: 600 } },
    ];
    // (800 × 10 + 600 × 5) / 15 = (8000 + 3000) / 15 = 733.33
    expect(getWeightedValue("OQ", slots)).toBeCloseTo(733.33, 1);
  });
});

describe("predictSchematic — end-to-end ceiling read", () => {
  it("perfect-resource fill on a single-stat group hits the cap", () => {
    const slots = [hypotheticalPerfectFill(10)];
    const result = predictSchematic({
      slots,
      propertyGroups: [
        {
          id: 1,
          propertyName: "mindamage",
          expGroup: "expDamage",
          weights: [{ stat: "OQ", weight: 1 }],
        },
      ],
    });
    expect(result.experimentationPointBudget).toBe(11); // default 110 / 10
    const g = result.propertyGroups[0];
    expect(g.weightedSum).toBe(1000);
    expect(g.maxPercent).toBeCloseTo(100);
    expect(g.startingPercent).toBeCloseTo(30);
    expect(g.focusedPercent).toBeCloseTo(100); // 30 + 11×7 = 107 → clamp 100
  });

  it("low-weight resource gives proportionally lower output", () => {
    const slots = [
      // 500 across stats — half-quality bar
      {
        unitsRequired: 10,
        stats: {
          CR: 500,
          CD: 500,
          DR: 500,
          HR: 500,
          FL: 500,
          MA: 500,
          PE: 500,
          OQ: 500,
          SR: 500,
          UT: 500,
        },
      },
    ];
    const result = predictSchematic({
      slots,
      propertyGroups: [
        {
          id: 1,
          propertyName: "mindamage",
          expGroup: "expDamage",
          weights: [{ stat: "OQ", weight: 1 }],
        },
      ],
    });
    const g = result.propertyGroups[0];
    expect(g.weightedSum).toBe(500);
    expect(g.maxPercent).toBeCloseTo(50);
    expect(g.startingPercent).toBeCloseTo(11.25);
    // 11.25 + 77 = 88.25 → clamped to maxPct 50
    expect(g.focusedPercent).toBeCloseTo(50);
  });

  it("non-scoreable property group (zero weights) returns zeros", () => {
    const result = predictSchematic({
      slots: [hypotheticalPerfectFill()],
      propertyGroups: [
        { id: 5, propertyName: null, expGroup: null, weights: [] },
      ],
    });
    const g = result.propertyGroups[0];
    expect(g.weightedSum).toBe(0);
    expect(g.maxPercent).toBe(0);
    expect(g.startingPercent).toBe(0);
    expect(g.focusedPercent).toBe(0);
  });

  it("multi-stat property group blends per weight share", () => {
    // Group with weights {OQ: 2, CD: 1}. Total 3. Shares: OQ 2/3, CD 1/3.
    // Slot has OQ=900, CD=600.
    // weightedSum = 900×(2/3) + 600×(1/3) = 600 + 200 = 800
    const slots = [
      {
        unitsRequired: 5,
        stats: {
          CR: null, CD: 600, DR: null, HR: null, FL: null, MA: null,
          PE: null, OQ: 900, SR: null, UT: null,
        },
      },
    ];
    const result = predictSchematic({
      slots,
      propertyGroups: [
        {
          id: 1,
          propertyName: "mindamage",
          expGroup: "expDamage",
          weights: [{ stat: "OQ", weight: 2 }, { stat: "CD", weight: 1 }],
        },
      ],
    });
    expect(result.propertyGroups[0].weightedSum).toBeCloseTo(800);
  });

  it("BARELYSUCCESSFUL assembly tier scales starting% by 0.4", () => {
    const slots = [hypotheticalPerfectFill()];
    const result = predictSchematic({
      slots,
      assemblyTier: ASSEMBLY_TIER.BARELYSUCCESSFUL,
      propertyGroups: [
        {
          id: 1,
          propertyName: "mindamage",
          expGroup: "expDamage",
          weights: [{ stat: "OQ", weight: 1 }],
        },
      ],
    });
    const g = result.propertyGroups[0];
    expect(g.startingPercent).toBeCloseTo(30 * 0.4); // 12
  });
});
