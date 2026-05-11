import { describe, expect, it } from "vitest";
import type { StatKey } from "@shared/ipc-types";
import type { ResourceStats, StatWeight } from "./types";
import { scoreGroup } from "./score";

// Helper: build the 11-key Record with most stats null and only the listed
// ones set. Keeps the test bodies readable.
function stats(partial: Partial<Record<StatKey, number>>): ResourceStats {
  return {
    OQ: partial.OQ ?? null,
    CR: partial.CR ?? null,
    CD: partial.CD ?? null,
    DR: partial.DR ?? null,
    FL: partial.FL ?? null,
    HR: partial.HR ?? null,
    MA: partial.MA ?? null,
    PE: partial.PE ?? null,
    SR: partial.SR ?? null,
    UT: partial.UT ?? null,
    ER: partial.ER ?? null,
  };
}

describe("scoreGroup — design report §5.2.8 worked example", () => {
  // §5.2.8: T21 Stock weights 66% OQ + 33% SR, Aakuran Steel OQ 940, SR 800
  // → score = (66/99)·(940/1000) + (33/99)·(800/1000) = 0.6266·0.94 + 0.3333·0.80
  // Universal-bounds scoring (the example used cap=1000 floor=0 explicitly).
  it("matches the design doc's Aakuran Steel = 89.33 calculation", () => {
    const weights: StatWeight[] = [
      { stat: "OQ", weight: 66 },
      { stat: "SR", weight: 33 },
    ];
    const score = scoreGroup(stats({ OQ: 940, SR: 800 }), weights);
    expect(score).not.toBeNull();
    // (66/99)*94 + (33/99)*80 ≈ 62.67 + 26.67 = 89.33
    expect(score!).toBeCloseTo((66 / 99) * 94 + (33 / 99) * 80, 5);
  });

  // §5.2.8 second pass: Polysteel Copper OQ 968, SR 821 should score higher.
  it("Polysteel Copper outscores Aakuran on the same weights", () => {
    const weights: StatWeight[] = [
      { stat: "OQ", weight: 66 },
      { stat: "SR", weight: 33 },
    ];
    const aakuran = scoreGroup(stats({ OQ: 940, SR: 800 }), weights);
    const polysteel = scoreGroup(stats({ OQ: 968, SR: 821 }), weights);
    expect(polysteel).not.toBeNull();
    expect(aakuran).not.toBeNull();
    expect(polysteel!).toBeGreaterThan(aakuran!);
  });
});

describe("scoreGroup — real T21 mindamage data shape", () => {
  // The actual T21 Rifle mindamage group: weights CD:1 + OQ:1, weightTotal 2.
  // Resource with CD=900, OQ=950 → 0.5*(900/1000) + 0.5*(950/1000) = 0.925 → 92.5.
  it("equal-weight CD+OQ resolves to mean stat / 10", () => {
    const weights: StatWeight[] = [
      { stat: "CD", weight: 1 },
      { stat: "OQ", weight: 1 },
    ];
    const score = scoreGroup(stats({ CD: 900, OQ: 950 }), weights);
    expect(score).toBeCloseTo(92.5, 5);
  });

  // Advanced Stock's mindamage: weights SR:1 only, weightTotal 1.
  it("single-stat 100% weight equals stat / 10", () => {
    const weights: StatWeight[] = [{ stat: "SR", weight: 1 }];
    const score = scoreGroup(stats({ SR: 800 }), weights);
    expect(score).toBeCloseTo(80, 5);
  });

  // Real-world bug from Phase 5 verification: bocofiiam Axidite Iron CD 198,
  // SR 642 on Blaster Pistol Barrel mindamage (CD:2 + SR:1, ~67%/33%).
  // Expected universal score ≈ 34.5; previously the per-type scoring inflated
  // this to 92.3. This test pins the regression.
  it("bocofiiam-style: low absolute stats produce a low absolute score", () => {
    const weights: StatWeight[] = [
      { stat: "CD", weight: 2 },
      { stat: "SR", weight: 1 },
    ];
    const score = scoreGroup(stats({ CD: 198, SR: 642 }), weights);
    // (2/3)*19.8 + (1/3)*64.2 = 13.20 + 21.40 = 34.60
    expect(score).toBeCloseTo((2 / 3) * 19.8 + (1 / 3) * 64.2, 3);
  });

  it("haosesis-style: high absolute stats produce a high absolute score", () => {
    const weights: StatWeight[] = [
      { stat: "CD", weight: 2 },
      { stat: "SR", weight: 1 },
    ];
    const score = scoreGroup(stats({ CD: 932, SR: 760 }), weights);
    // (2/3)*93.2 + (1/3)*76.0 = 62.13 + 25.33 = 87.47
    expect(score).toBeCloseTo((2 / 3) * 93.2 + (1 / 3) * 76.0, 3);
  });
});

describe("scoreGroup — null and edge cases", () => {
  it("returns null when a weighted stat is null", () => {
    const weights: StatWeight[] = [{ stat: "OQ", weight: 1 }];
    const score = scoreGroup(stats({}), weights);
    expect(score).toBeNull();
  });

  it("returns null on empty weight list", () => {
    const score = scoreGroup(stats({ OQ: 900 }), []);
    expect(score).toBeNull();
  });

  it("normalises unequal weights correctly (weight sum != 100)", () => {
    // Weights 3 and 1 → 75% / 25% split. Resource at universal max on
    // weight-3 stat, at 0 on weight-1 stat → 75% * 1.0 + 25% * 0.0 = 75.
    const weights: StatWeight[] = [
      { stat: "OQ", weight: 3 },
      { stat: "SR", weight: 1 },
    ];
    const score = scoreGroup(stats({ OQ: 1000, SR: 0 }), weights);
    expect(score).toBeCloseTo(75, 5);
  });

  it("stat=1000 (universal max) on a single-weight group → 100", () => {
    const score = scoreGroup(stats({ OQ: 1000 }), [{ stat: "OQ", weight: 1 }]);
    expect(score).toBe(100);
  });

  it("stat=0 on a single-weight group → 0", () => {
    const score = scoreGroup(stats({ OQ: 0 }), [{ stat: "OQ", weight: 1 }]);
    expect(score).toBe(0);
  });
});
