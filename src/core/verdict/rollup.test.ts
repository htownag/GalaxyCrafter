import { describe, expect, it } from "vitest";
import { CHASE_THRESHOLD, MAYBE_THRESHOLD, rollupResourceVerdict } from "./rollup";
import type { ScoredMatch } from "./types";

function match(over: Partial<ScoredMatch> = {}): ScoredMatch {
  return {
    schematicId: "weapon_rifle_t21",
    schematicName: "T21 Rifle",
    propertyGroupId: 101120,
    propertyName: "mindamage",
    expGroup: "expDamage",
    score: 50,
    inheritedFromParent: false,
    ...over,
  };
}

describe("rollupResourceVerdict — tier thresholds", () => {
  it("CHASE at exactly the threshold", () => {
    const v = rollupResourceVerdict([match({ score: CHASE_THRESHOLD })]);
    expect(v?.tier).toBe("CHASE");
  });

  it("MAYBE at exactly the threshold", () => {
    const v = rollupResourceVerdict([match({ score: MAYBE_THRESHOLD })]);
    expect(v?.tier).toBe("MAYBE");
  });

  it("returns null below MAYBE threshold (SKIP not written)", () => {
    const v = rollupResourceVerdict([match({ score: MAYBE_THRESHOLD - 0.1 })]);
    expect(v).toBeNull();
  });

  it("returns null on empty match list", () => {
    expect(rollupResourceVerdict([])).toBeNull();
  });

  it("CHASE supersedes MAYBE — top score wins", () => {
    const v = rollupResourceVerdict([
      match({ score: 72, schematicId: "a" }),
      match({ score: 95, schematicId: "b" }),
      match({ score: 80, schematicId: "c" }),
    ]);
    expect(v?.tier).toBe("CHASE");
    expect(v?.topScore).toBe(95);
  });
});

describe("rollupResourceVerdict — breakdown and reason", () => {
  it("breakdown is sorted highest score first", () => {
    const v = rollupResourceVerdict([
      match({ score: 75, schematicId: "low" }),
      match({ score: 92, schematicId: "high" }),
      match({ score: 85, schematicId: "mid" }),
    ]);
    expect(v?.breakdown[0].schematicId).toBe("high");
    expect(v?.breakdown[1].schematicId).toBe("mid");
    expect(v?.breakdown[2].schematicId).toBe("low");
  });

  it("counts distinct schematics (multiple matches per schematic = one count)", () => {
    const v = rollupResourceVerdict([
      match({ score: 90, schematicId: "a", propertyGroupId: 1 }),
      match({ score: 85, schematicId: "a", propertyGroupId: 2 }),
      match({ score: 80, schematicId: "b", propertyGroupId: 3 }),
    ]);
    expect(v?.matchedSchematicCount).toBe(2);
  });

  it("reason mentions schematic name + property + (+N more) when multi-match", () => {
    const v = rollupResourceVerdict([
      match({ score: 92, schematicId: "a", schematicName: "T21 Rifle", propertyName: "mindamage" }),
      match({ score: 80, schematicId: "b", schematicName: "DH17 Stock" }),
    ]);
    expect(v?.reason).toContain("T21 Rifle");
    expect(v?.reason).toContain("mindamage");
    expect(v?.reason).toContain("+1 more");
  });

  it("reason omits +N more for single-schematic match", () => {
    const v = rollupResourceVerdict([
      match({ score: 92, schematicName: "T21 Rifle", propertyName: "mindamage" }),
    ]);
    expect(v?.reason).not.toContain("more");
  });
});
