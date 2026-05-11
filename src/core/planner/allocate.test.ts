import { describe, expect, it } from "vitest";
import { allocate, type Candidate } from "./allocate";

function cand(opts: Partial<Candidate> & { id: string; dv: number }): Candidate {
  return {
    resourceId: opts.id,
    resourceName: opts.id,
    planet: opts.planet ?? "tatooine",
    resourceScore: opts.resourceScore ?? 90,
    bucket: opts.bucket ?? "mineral",
    size: opts.size ?? "heavy",
    ber: opts.ber ?? 7,
    harvesterId: opts.harvesterId ?? "heavy_mineral",
    harvesterLabel: opts.harvesterLabel ?? "Heavy Mineral",
    deploymentValue: opts.dv,
    estDailyYield: opts.estDailyYield ?? 168,
  };
}

describe("allocate", () => {
  it("returns empty when lotsAvailable is 0", () => {
    const result = allocate({
      candidates: [cand({ id: "a", dv: 100 })],
      lotsAvailable: 0,
      diversity: true,
    });
    expect(result.selected).toHaveLength(0);
    expect(result.summary.lotsUsed).toBe(0);
  });

  it("clamps lotsAvailable to 10 (SWG hard cap)", () => {
    const candidates = Array.from({ length: 15 }, (_, i) =>
      cand({ id: `r${i}`, dv: 100 - i }),
    );
    const result = allocate({ candidates, lotsAvailable: 12, diversity: false });
    expect(result.selected).toHaveLength(10);
  });

  it("picks highest deploymentValue first", () => {
    const result = allocate({
      candidates: [
        cand({ id: "low", dv: 50 }),
        cand({ id: "high", dv: 200 }),
        cand({ id: "mid", dv: 100 }),
      ],
      lotsAvailable: 2,
      diversity: false,
    });
    expect(result.selected.map((c) => c.resourceId)).toEqual(["high", "mid"]);
  });

  it("deduplicates by resourceId (a resource can't fill two lots)", () => {
    const result = allocate({
      candidates: [
        cand({ id: "iron_dolovite", dv: 200, planet: "tatooine" }),
        cand({ id: "iron_dolovite", dv: 180, planet: "naboo" }),
        cand({ id: "copper_xerium", dv: 150 }),
      ],
      lotsAvailable: 2,
      diversity: false,
    });
    expect(result.selected.map((c) => c.resourceId)).toEqual([
      "iron_dolovite",
      "copper_xerium",
    ]);
  });

  it("enforces bucket cap = ceil(lotsAvailable * 0.6) when diversity=true", () => {
    // 5 mineral candidates all scoring high, 1 energy lower
    const candidates = [
      cand({ id: "m1", dv: 100, bucket: "mineral" }),
      cand({ id: "m2", dv: 95, bucket: "mineral" }),
      cand({ id: "m3", dv: 90, bucket: "mineral" }),
      cand({ id: "m4", dv: 85, bucket: "mineral" }),
      cand({ id: "m5", dv: 80, bucket: "mineral" }),
      cand({ id: "e1", dv: 50, bucket: "energy" }),
    ];
    // lotsAvailable=5 → cap = ceil(5*0.6) = 3
    const result = allocate({ candidates, lotsAvailable: 5, diversity: true });
    expect(result.summary.bucketBreakdown.mineral).toBe(3);
    expect(result.summary.bucketBreakdown.energy).toBeGreaterThan(0);
  });

  it("disables bucket cap when diversity=false", () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      cand({ id: `m${i}`, dv: 100 - i, bucket: "mineral" }),
    );
    const result = allocate({ candidates, lotsAvailable: 5, diversity: false });
    expect(result.summary.bucketBreakdown.mineral).toBe(5);
    expect(result.selected).toHaveLength(5);
  });

  it("ranks selected items 1..N in descending dv order", () => {
    const result = allocate({
      candidates: [
        cand({ id: "a", dv: 10 }),
        cand({ id: "b", dv: 30 }),
        cand({ id: "c", dv: 20 }),
      ],
      lotsAvailable: 3,
      diversity: false,
    });
    expect(result.selected.map((c) => ({ rank: c.rank, id: c.resourceId }))).toEqual([
      { rank: 1, id: "b" },
      { rank: 2, id: "c" },
      { rank: 3, id: "a" },
    ]);
  });

  it("summary.totalDeploymentValue sums selected deploymentValues", () => {
    const result = allocate({
      candidates: [
        cand({ id: "a", dv: 100 }),
        cand({ id: "b", dv: 50 }),
      ],
      lotsAvailable: 2,
      diversity: false,
    });
    expect(result.summary.totalDeploymentValue).toBe(150);
  });
});
