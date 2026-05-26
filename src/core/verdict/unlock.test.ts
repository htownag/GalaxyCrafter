import { describe, expect, it } from "vitest";
import {
  type ActiveSlot,
  type UnlockEntry,
  computeResourceUnlocks,
  computeUncoveredSlots,
} from "./unlock";

// Helper: build the fitsSlot predicate from a flat (typeId, slot) → boolean
// table. Keeps the test bodies readable.
function makeFits(table: Record<string, string[]>) {
  return (typeId: string, ingredientObject: string): boolean =>
    (table[typeId] ?? []).includes(ingredientObject);
}

describe("computeUncoveredSlots — Q2 (live + reserved cover, despawned doesn't)", () => {
  // The Q2 advisor-flipped case driven by Ryan's framing:
  // 50 despawned units of iron_dolovite + 0 live → slot still UNCOVERED.
  // The orchestrator passes only live+reserved typeIds into coveringTypeIds,
  // so this test pins the per-status filter on the OUTER side: when the
  // orchestrator hands us an empty covering set, the slot is uncovered.
  it("empty covering set → all slots uncovered", () => {
    const slots: ActiveSlot[] = [
      {
        schematicId: "scope_adv",
        schematicName: "Advanced Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
    ];
    const fitsSlot = makeFits({ res_chrom: ["chromium_aluminum"] });
    const uncovered = computeUncoveredSlots(slots, new Set(), fitsSlot);
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0].slotName).toBe("chromium_aluminum");
  });

  it("covering set with a fitting type → slot covered", () => {
    const slots: ActiveSlot[] = [
      {
        schematicId: "scope_adv",
        schematicName: "Advanced Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
    ];
    const fitsSlot = makeFits({ res_chrom: ["chromium_aluminum"] });
    const uncovered = computeUncoveredSlots(
      slots,
      new Set(["res_chrom"]),
      fitsSlot,
    );
    expect(uncovered).toHaveLength(0);
  });

  it("covering set with a non-fitting type → slot still uncovered", () => {
    const slots: ActiveSlot[] = [
      {
        schematicId: "scope_adv",
        schematicName: "Advanced Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
    ];
    // res_iron doesn't fit the chromium slot.
    const fitsSlot = makeFits({ res_iron: ["iron_dolovite"] });
    const uncovered = computeUncoveredSlots(
      slots,
      new Set(["res_iron"]),
      fitsSlot,
    );
    expect(uncovered).toHaveLength(1);
  });

  it("multiple slots → partial coverage emits only uncovered", () => {
    const slots: ActiveSlot[] = [
      {
        schematicId: "t21",
        schematicName: "T21",
        slotName: "stock",
        ingredientObject: "aluminum",
      },
      {
        schematicId: "t21",
        schematicName: "T21",
        slotName: "barrel",
        ingredientObject: "steel",
      },
      {
        schematicId: "t21",
        schematicName: "T21",
        slotName: "scope",
        ingredientObject: "chromium_aluminum",
      },
    ];
    const fitsSlot = makeFits({
      res_alum: ["aluminum"],
      res_steel: ["steel"],
    });
    const uncovered = computeUncoveredSlots(
      slots,
      new Set(["res_alum", "res_steel"]),
      fitsSlot,
    );
    // Stock + barrel covered; scope uncovered.
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0].slotName).toBe("scope");
  });

  it("preserves per-slot context for the UI", () => {
    const slots: ActiveSlot[] = [
      {
        schematicId: "scope_adv",
        schematicName: "Advanced Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
    ];
    const fitsSlot = makeFits({});
    const uncovered = computeUncoveredSlots(slots, new Set(), fitsSlot);
    expect(uncovered[0]).toEqual({
      schematicId: "scope_adv",
      schematicName: "Advanced Weapon Scope",
      slotName: "chromium_aluminum",
      ingredientObject: "chromium_aluminum",
    });
  });

  it("same slot appearing on two schematics emits two uncovered entries", () => {
    // Sub-component inheritance case: Item 1 sub-component has its own raw
    // slots and shows up as a separate active-schematic row. If both the
    // parent and the sub-component's slot are uncovered, the UI shows two
    // separate entries (one per schematic) so the player can navigate to
    // either.
    const slots: ActiveSlot[] = [
      {
        schematicId: "scope_adv",
        schematicName: "Advanced Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
      {
        schematicId: "scope_basic",
        schematicName: "Basic Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
    ];
    const fitsSlot = makeFits({});
    const uncovered = computeUncoveredSlots(slots, new Set(), fitsSlot);
    expect(uncovered).toHaveLength(2);
    expect(uncovered.map((u) => u.schematicId).sort()).toEqual([
      "scope_adv",
      "scope_basic",
    ]);
  });
});

describe("computeResourceUnlocks — per-candidate unlock list", () => {
  // The chromium aluminum scenario from Ryan's request: a mediocre Chromium
  // Aluminum should still UNLOCK the Advanced Weapon Scope when the player
  // owns zero.
  it("chromium-aluminum unlock: matches its uncovered slot", () => {
    const uncovered: UnlockEntry[] = [
      {
        schematicId: "scope_adv",
        schematicName: "Advanced Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
    ];
    const fitsSlot = makeFits({ res_chrom: ["chromium_aluminum"] });
    const unlocks = computeResourceUnlocks("res_chrom", uncovered, fitsSlot);
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0].slotName).toBe("chromium_aluminum");
  });

  it("non-fitting resource → empty unlock list", () => {
    const uncovered: UnlockEntry[] = [
      {
        schematicId: "scope_adv",
        schematicName: "Advanced Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
    ];
    const fitsSlot = makeFits({ res_iron: ["iron_dolovite"] });
    const unlocks = computeResourceUnlocks("res_iron", uncovered, fitsSlot);
    expect(unlocks).toHaveLength(0);
  });

  it("polymorphic family: one resource unlocks two schematics on the same family", () => {
    // Petrochem polymer fits both Armor Segment and Power Handler. If the
    // player owns zero polymer, the spawn UNLOCKS both.
    const uncovered: UnlockEntry[] = [
      {
        schematicId: "armor_seg",
        schematicName: "Armor Segment",
        slotName: "polymer",
        ingredientObject: "petrochem_polymer",
      },
      {
        schematicId: "power_hndl",
        schematicName: "Power Handler",
        slotName: "polymer",
        ingredientObject: "petrochem_polymer",
      },
    ];
    const fitsSlot = makeFits({ res_poly: ["petrochem_polymer"] });
    const unlocks = computeResourceUnlocks("res_poly", uncovered, fitsSlot);
    expect(unlocks).toHaveLength(2);
    expect(unlocks.map((u) => u.schematicId).sort()).toEqual([
      "armor_seg",
      "power_hndl",
    ]);
  });

  it("returns empty array (not null) when no uncovered slots exist", () => {
    const fitsSlot = makeFits({});
    const unlocks = computeResourceUnlocks("res_chrom", [], fitsSlot);
    expect(unlocks).toEqual([]);
  });
});

describe("UNLOCK end-to-end through both helpers — Ryan's chromium-aluminum scenario", () => {
  // Concrete repro of Ryan's gap: "I don't have any chromium aluminum but
  // I want to make advanced weapon scopes. So if one spawns, it doesn't
  // matter if it sucks, it's my first."
  it("zero inventory + spawning chromium aluminum → UNLOCK fires", () => {
    const activeSlots: ActiveSlot[] = [
      {
        schematicId: "scope_adv",
        schematicName: "Advanced Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
    ];
    // Zero covering inventory.
    const coveringTypeIds = new Set<string>();
    const fitsSlot = makeFits({ res_chrom: ["chromium_aluminum"] });

    const uncovered = computeUncoveredSlots(activeSlots, coveringTypeIds, fitsSlot);
    expect(uncovered).toHaveLength(1);

    const unlocks = computeResourceUnlocks("res_chrom", uncovered, fitsSlot);
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0].schematicName).toBe("Advanced Weapon Scope");
  });

  it("live inventory of fitting type → no UNLOCK for the same family", () => {
    const activeSlots: ActiveSlot[] = [
      {
        schematicId: "scope_adv",
        schematicName: "Advanced Weapon Scope",
        slotName: "chromium_aluminum",
        ingredientObject: "chromium_aluminum",
      },
    ];
    // Player has some chromium aluminum already, status=live.
    const coveringTypeIds = new Set(["res_chrom"]);
    const fitsSlot = makeFits({ res_chrom: ["chromium_aluminum"] });

    const uncovered = computeUncoveredSlots(activeSlots, coveringTypeIds, fitsSlot);
    expect(uncovered).toHaveLength(0);

    const unlocks = computeResourceUnlocks("res_chrom2", uncovered, fitsSlot);
    expect(unlocks).toHaveLength(0);
  });

  // v0.1.8 reverted the v0.1.6 "despawned doesn't cover" rule. The
  // orchestrator now passes ALL statuses into coveringTypeIds. Real-world
  // evidence: players hold large stockpiles of despawned material they
  // actively craft from — treating them as uncovered made UNLOCK fire
  // on families they were already swimming in. Replenishment of
  // drainable stashes belongs in a future REORDER lane, not UNLOCK.
  it("despawned inventory DOES cover (v0.1.8 — all statuses count)", () => {
    const activeSlots: ActiveSlot[] = [
      {
        schematicId: "armor_seg",
        schematicName: "Armor Segment",
        slotName: "iron",
        ingredientObject: "iron",
      },
    ];
    // Player has 30,000 units of iron_dolovite, status='despawned'. The
    // orchestrator now INCLUDES that row in coveringTypeIds.
    const coveringTypeIds = new Set(["res_iron_dolovite"]);
    const fitsSlot = makeFits({
      res_iron_dolovite: ["iron", "iron_dolovite"],
      res_iron_anaxite: ["iron", "iron_anaxite"],
    });

    const uncovered = computeUncoveredSlots(activeSlots, coveringTypeIds, fitsSlot);
    expect(uncovered).toHaveLength(0);

    // A fresh iron_anaxite spawn does NOT fire UNLOCK — the family is covered
    // by the despawned stash, no matter how mediocre it is.
    const unlocks = computeResourceUnlocks(
      "res_iron_anaxite",
      uncovered,
      fitsSlot,
    );
    expect(unlocks).toHaveLength(0);
  });

  it("reserved inventory covers (intent-tagged, never went away)", () => {
    const activeSlots: ActiveSlot[] = [
      {
        schematicId: "armor_seg",
        schematicName: "Armor Segment",
        slotName: "iron",
        ingredientObject: "iron",
      },
    ];
    const coveringTypeIds = new Set(["res_iron"]);
    const fitsSlot = makeFits({ res_iron: ["iron"] });

    const uncovered = computeUncoveredSlots(activeSlots, coveringTypeIds, fitsSlot);
    expect(uncovered).toHaveLength(0);
  });
});
