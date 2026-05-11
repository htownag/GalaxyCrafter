import { describe, expect, it } from "vitest";
import { resourceBucket } from "./buckets";

describe("resourceBucket", () => {
  it("classifies a mineral resource (iron under inorganic→mineral→metal_ferrous→iron)", () => {
    const ancestors = new Set([
      "iron_dolovite",
      "iron",
      "metal_ferrous",
      "metal",
      "mineral",
      "inorganic",
      "resource",
    ]);
    expect(resourceBucket(ancestors)).toBe("mineral");
  });

  it("classifies a chemical resource", () => {
    const ancestors = new Set([
      "lubricating_oil",
      "lubricating_oil",
      "chemical",
      "inorganic",
      "resource",
    ]);
    expect(resourceBucket(ancestors)).toBe("chemical");
  });

  it("classifies an energy resource (wind under energy→energy_renewable)", () => {
    const ancestors = new Set([
      "energy_renewable_wind_naboo",
      "energy_renewable",
      "energy",
      "resource",
    ]);
    expect(resourceBucket(ancestors)).toBe("energy");
  });

  it("returns null for organic (out of v1 bucket coverage)", () => {
    const ancestors = new Set([
      "wild_meat_bantha",
      "meat",
      "creature_food",
      "creature_resources",
      "organic",
      "resource",
    ]);
    expect(resourceBucket(ancestors)).toBeNull();
  });

  it("returns null for water (out of v1 bucket coverage)", () => {
    const ancestors = new Set(["water_tatooine", "water", "inorganic", "resource"]);
    expect(resourceBucket(ancestors)).toBeNull();
  });

  it("returns null for empty / unknown ancestry", () => {
    expect(resourceBucket(new Set())).toBeNull();
    expect(resourceBucket(new Set(["unknown"]))).toBeNull();
  });
});
