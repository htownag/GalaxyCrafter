import { describe, expect, it } from "vitest";
import { buildTypeAncestorMap, resourceTypeFitsRawSlot } from "./compat";

describe("buildTypeAncestorMap", () => {
  it("groups multiple ancestors per type", () => {
    const edges = [
      { typeId: "milk_homogenized", groupId: "organic" },
      { typeId: "milk_homogenized", groupId: "creature_food" },
      { typeId: "milk_homogenized", groupId: "milk" },
    ];
    const map = buildTypeAncestorMap(edges);
    expect(map.get("milk_homogenized")?.size).toBe(3);
    expect(map.get("milk_homogenized")?.has("milk")).toBe(true);
  });

  it("handles empty input", () => {
    expect(buildTypeAncestorMap([]).size).toBe(0);
  });
});

describe("resourceTypeFitsRawSlot", () => {
  // A slot that wants "aluminum" (group): any aluminum_* type fits.
  // A slot that wants "aluminum_phrik" (specific type): only that exact type fits.
  const edges = [
    { typeId: "aluminum_phrik", groupId: "aluminum" },
    { typeId: "aluminum_phrik", groupId: "metal" },
    { typeId: "aluminum_perovskitic", groupId: "aluminum" },
    { typeId: "aluminum_perovskitic", groupId: "metal" },
    { typeId: "copper_polysteel", groupId: "copper" },
    { typeId: "copper_polysteel", groupId: "metal" },
  ];
  const map = buildTypeAncestorMap(edges);

  it("matches via direct type ID", () => {
    expect(resourceTypeFitsRawSlot("aluminum_phrik", "aluminum_phrik", map)).toBe(true);
  });

  it("matches via group ancestor", () => {
    expect(resourceTypeFitsRawSlot("aluminum_phrik", "aluminum", map)).toBe(true);
    expect(resourceTypeFitsRawSlot("aluminum_phrik", "metal", map)).toBe(true);
  });

  it("rejects non-ancestor groups", () => {
    expect(resourceTypeFitsRawSlot("aluminum_phrik", "copper", map)).toBe(false);
    expect(resourceTypeFitsRawSlot("aluminum_phrik", "organic", map)).toBe(false);
  });

  it("rejects unrelated specific types", () => {
    expect(resourceTypeFitsRawSlot("aluminum_phrik", "aluminum_perovskitic", map)).toBe(false);
  });

  it("handles types with no edges (returns false unless direct match)", () => {
    expect(resourceTypeFitsRawSlot("unknown_type", "metal", map)).toBe(false);
    expect(resourceTypeFitsRawSlot("unknown_type", "unknown_type", map)).toBe(true);
  });
});
