import { describe, expect, it } from "vitest";
import {
  ABS_CHASE_THRESHOLD,
  ABS_MAYBE_THRESHOLD,
  DELTA_MAYBE,
  HIGH_SCORE_CHASE_FLOOR,
  HIGH_SCORE_MAYBE_FLOOR,
  matchTier,
  rollupResourceVerdict,
} from "./rollup";
import type { ScoredMatch } from "./types";

function match(over: Partial<ScoredMatch> = {}): ScoredMatch {
  return {
    schematicId: "weapon_rifle_t21",
    schematicName: "T21 Rifle",
    propertyGroupId: 101120,
    propertyName: "mindamage",
    expGroup: "expDamage",
    score: 50,
    scoreOwned: 0,
    tier: "SKIP",
    inheritedFromParent: false,
    ...over,
  };
}

describe("matchTier — empty-inventory path (scoreOwned == 0)", () => {
  it("CHASE at exactly the absolute CHASE threshold", () => {
    expect(matchTier(ABS_CHASE_THRESHOLD, 0)).toBe("CHASE");
  });
  it("MAYBE at exactly the absolute MAYBE threshold", () => {
    expect(matchTier(ABS_MAYBE_THRESHOLD, 0)).toBe("MAYBE");
  });
  it("SKIP below the absolute MAYBE threshold", () => {
    expect(matchTier(ABS_MAYBE_THRESHOLD - 0.1, 0)).toBe("SKIP");
  });
  it("regression: 85/65 baseline matches Phase 3 contract", () => {
    expect(matchTier(95, 0)).toBe("CHASE");
    expect(matchTier(70, 0)).toBe("MAYBE");
    expect(matchTier(40, 0)).toBe("SKIP");
  });
});

describe("matchTier — delta path (scoreOwned > 0)", () => {
  it("CHASE when delta >= DELTA_CHASE (regardless of absolute score)", () => {
    // owned 50, score 58 → delta 8 → CHASE
    expect(matchTier(58, 50)).toBe("CHASE");
  });
  it("CHASE when score >= HIGH_SCORE_CHASE_FLOOR AND delta >= DELTA_MAYBE", () => {
    // owned 87, score 90 → delta 3 + score >= 90 → CHASE
    expect(matchTier(HIGH_SCORE_CHASE_FLOOR, HIGH_SCORE_CHASE_FLOOR - DELTA_MAYBE)).toBe("CHASE");
  });
  it("MAYBE when delta >= DELTA_MAYBE but neither CHASE rule fires", () => {
    // owned 50, score 53 → delta 3, score < 90 → MAYBE
    expect(matchTier(53, 50)).toBe("MAYBE");
  });
  it("MAYBE when score >= HIGH_SCORE_MAYBE_FLOOR with small delta", () => {
    // owned 84, score 85 → delta 1, score >= 85 → MAYBE
    expect(matchTier(HIGH_SCORE_MAYBE_FLOOR, HIGH_SCORE_MAYBE_FLOOR - 1)).toBe("MAYBE");
  });
  it("SKIP when delta < DELTA_MAYBE AND score < HIGH_SCORE_MAYBE_FLOOR", () => {
    // owned 80, score 81 → delta 1, score < 85 → SKIP
    expect(matchTier(81, 80)).toBe("SKIP");
  });
  it("SKIP when new score is worse than owned (delta negative)", () => {
    expect(matchTier(60, 80)).toBe("SKIP");
  });

  it("§5.2.8 worked example: Polysteel Copper 90.98 vs nothing owned → CHASE", () => {
    // First half of the doc's example, with empty inventory.
    expect(matchTier(90.98, 0)).toBe("CHASE");
  });
  it("§5.2.8 worked example: Polysteel 90.98, owned Aakuran 88.44 → delta 2.54 + score 90 → MAYBE", () => {
    // Second half — delta < 3, so the >=90+>=3 CHASE rule doesn't fire,
    // and delta < 3 disqualifies bare MAYBE delta rule. But score >=
    // HIGH_SCORE_MAYBE_FLOOR (85) keeps it as MAYBE.
    expect(matchTier(90.98, 88.44)).toBe("MAYBE");
  });
});

describe("rollupResourceVerdict — per-match tier rollup", () => {
  it("CHASE supersedes MAYBE — max tier wins", () => {
    const v = rollupResourceVerdict([
      match({ score: 72, scoreOwned: 0, tier: matchTier(72, 0), schematicId: "a" }),
      match({ score: 95, scoreOwned: 0, tier: matchTier(95, 0), schematicId: "b" }),
      match({ score: 80, scoreOwned: 0, tier: matchTier(80, 0), schematicId: "c" }),
    ]);
    expect(v?.tier).toBe("CHASE");
    expect(v?.topScore).toBe(95);
  });

  it("returns null when all matches are SKIP", () => {
    const v = rollupResourceVerdict([
      match({ score: 50, scoreOwned: 0, tier: "SKIP", schematicId: "a" }),
      match({ score: 40, scoreOwned: 0, tier: "SKIP", schematicId: "b" }),
    ]);
    expect(v).toBeNull();
  });

  it("returns null on empty match list", () => {
    expect(rollupResourceVerdict([])).toBeNull();
  });

  it("breakdown sorted (tier desc, score desc)", () => {
    const v = rollupResourceVerdict([
      match({ score: 75, scoreOwned: 0, tier: "MAYBE", schematicId: "mid-maybe" }),
      match({ score: 92, scoreOwned: 0, tier: "CHASE", schematicId: "high-chase" }),
      match({ score: 85, scoreOwned: 0, tier: "MAYBE", schematicId: "high-maybe" }),
      match({ score: 40, scoreOwned: 0, tier: "SKIP", schematicId: "low-skip" }),
    ]);
    expect(v?.breakdown[0].schematicId).toBe("high-chase");
    expect(v?.breakdown[1].schematicId).toBe("high-maybe");
    expect(v?.breakdown[2].schematicId).toBe("mid-maybe");
    expect(v?.breakdown[3].schematicId).toBe("low-skip");
  });

  it("counts distinct schematics", () => {
    const v = rollupResourceVerdict([
      match({ score: 90, scoreOwned: 0, tier: "CHASE", schematicId: "a", propertyGroupId: 1 }),
      match({ score: 85, scoreOwned: 0, tier: "MAYBE", schematicId: "a", propertyGroupId: 2 }),
      match({ score: 80, scoreOwned: 0, tier: "MAYBE", schematicId: "b", propertyGroupId: 3 }),
    ]);
    expect(v?.matchedSchematicCount).toBe(2);
  });

  it("reason includes delta phrasing when owned > 0", () => {
    const v = rollupResourceVerdict([
      match({
        score: 92,
        scoreOwned: 85,
        tier: matchTier(92, 85),
        schematicName: "T21 Rifle",
        propertyName: "mindamage",
      }),
    ]);
    expect(v?.reason).toContain("+7.0 vs owned");
  });

  it("reason omits delta phrasing when owned == 0 (empty-inventory path)", () => {
    const v = rollupResourceVerdict([
      match({
        score: 90,
        scoreOwned: 0,
        tier: "CHASE",
        schematicName: "T21 Rifle",
        propertyName: "mindamage",
      }),
    ]);
    expect(v?.reason).not.toContain("vs owned");
  });
});
