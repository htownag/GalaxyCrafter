import { describe, expect, it } from "vitest";
import { isPowerResource, powerMultiplier, resourceBucket } from "./buckets";

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

describe("isPowerResource", () => {
  it("accepts solar (energy subtree)", () => {
    const ancestors = new Set([
      "energy_renewable_unlimited_solar_tatooine",
      "energy_renewable_unlimited_solar",
      "energy_renewable_unlimited",
      "energy_renewable",
      "energy",
      "resource",
    ]);
    expect(isPowerResource(ancestors)).toBe(true);
  });

  it("accepts wind (energy subtree)", () => {
    const ancestors = new Set([
      "energy_renewable_unlimited_wind_naboo",
      "energy_renewable_unlimited_wind",
      "energy",
      "resource",
    ]);
    expect(isPowerResource(ancestors)).toBe(true);
  });

  it("accepts radioactive (mineral subtype)", () => {
    const ancestors = new Set([
      "polymetric_radioactive_yavin4",
      "polymetric_radioactive",
      "radioactive",
      "mineral",
      "inorganic",
      "resource",
    ]);
    expect(isPowerResource(ancestors)).toBe(true);
  });

  it("rejects regular mineral (no power)", () => {
    const ancestors = new Set([
      "iron_dolovite",
      "iron",
      "metal_ferrous",
      "metal",
      "mineral",
      "inorganic",
      "resource",
    ]);
    expect(isPowerResource(ancestors)).toBe(false);
  });

  it("rejects petrochem fuel (chemical, not power per Core3)", () => {
    const ancestors = new Set([
      "petrochem_fuel_liquid_naboo",
      "petrochem_fuel_liquid",
      "petrochem_fuel",
      "petrochem",
      "chemical",
      "inorganic",
      "resource",
    ]);
    expect(isPowerResource(ancestors)).toBe(false);
  });
});

describe("powerMultiplier", () => {
  it("returns 1.0 for PE <= 500 (Core3 floor)", () => {
    expect(powerMultiplier(0)).toBe(1);
    expect(powerMultiplier(250)).toBe(1);
    expect(powerMultiplier(500)).toBe(1);
  });

  it("returns PE/500 for PE > 500", () => {
    expect(powerMultiplier(750)).toBeCloseTo(1.5);
    expect(powerMultiplier(1000)).toBe(2);
  });

  it("returns 1 for null / undefined", () => {
    expect(powerMultiplier(null)).toBe(1);
    expect(powerMultiplier(undefined)).toBe(1);
  });
});
