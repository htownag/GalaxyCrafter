// v0.1.6 UNLOCK — pure functions for slot coverage + per-resource unlock list.
//
// Coverage definition: a raw slot on an active schematic is COVERED iff
// the player owns at least one resource of a fitting type, regardless of
// inventory status (live, reserved, OR despawned).
//
// v0.1.8 note: an earlier rule (live + reserved only) was reverted after
// real-world usage showed players holding many-tens-of-thousands of units
// of despawned material — that's a stockpile they actively craft from,
// not a soon-to-drain bucket. Treating it as uncovered made UNLOCK
// fire constantly on families the player was already swimming in.
// Replenishment of drainable stashes belongs in a future REORDER lane,
// not in UNLOCK. See design-unlock-tier.md §Q2 errata for the reasoning.
//
// A spawning resource gets the UNLOCK flag iff it would cover at least one
// currently-uncovered slot on any active schematic. UNLOCK is orthogonal to
// quality — a trash 30-score chromium aluminum is still UNLOCK if the
// player owns zero. A 95-score chromium aluminum is BOTH UNLOCK and CHASE.
//
// These are pure functions: the orchestrator (`src/main/verdict/recompute.ts`)
// passes pre-computed inputs in (slot list, covering type IDs, fits-callback
// closing over the IFF/type-ancestor map). That keeps this module renderer-
// importable and database-free, so tests can stay synchronous + fast.

/**
 * One uncovered raw slot on an active schematic — also the per-slot detail
 * payload returned in the UI's "this resource UNLOCKS X" section.
 */
export interface UnlockEntry {
  schematicId: string;
  schematicName: string;
  slotName: string;
  /** The raw ingredient family the slot accepts (e.g. `chromium_aluminum`). */
  ingredientObject: string;
}

/**
 * Input shape for one raw slot from an active schematic. The orchestrator
 * flattens activeSchematic.rawSlots into one of these per (schematic, slot).
 */
export interface ActiveSlot {
  schematicId: string;
  schematicName: string;
  slotName: string;
  ingredientObject: string;
}

/**
 * Decide which active-schematic raw slots are CURRENTLY uncovered by the
 * player's covering inventory.
 *
 * @param activeSlots One row per (schematic, slot) across all active
 *                    schematics. Sub-component slots already excluded by
 *                    the caller (only ingredientType=0 raw slots).
 * @param coveringTypeIds The distinct typeIds of all inventory entries
 *                        with status `live` OR `reserved`.
 * @param fitsSlot Predicate that returns true when a resource of `typeId`
 *                 satisfies a slot expecting `ingredientObject`. Closes
 *                 over the IFF compat / type-ancestor map.
 */
export function computeUncoveredSlots(
  activeSlots: ActiveSlot[],
  coveringTypeIds: Set<string>,
  fitsSlot: (typeId: string, ingredientObject: string) => boolean,
): UnlockEntry[] {
  const uncovered: UnlockEntry[] = [];
  for (const slot of activeSlots) {
    let covered = false;
    for (const typeId of coveringTypeIds) {
      if (fitsSlot(typeId, slot.ingredientObject)) {
        covered = true;
        break;
      }
    }
    if (!covered) {
      uncovered.push({
        schematicId: slot.schematicId,
        schematicName: slot.schematicName,
        slotName: slot.slotName,
        ingredientObject: slot.ingredientObject,
      });
    }
  }
  return uncovered;
}

/**
 * For one candidate resource, list which uncovered slots its type would
 * cover. Empty array → no UNLOCK; non-empty → UNLOCK fires.
 */
export function computeResourceUnlocks(
  resourceTypeId: string,
  uncoveredSlots: UnlockEntry[],
  fitsSlot: (typeId: string, ingredientObject: string) => boolean,
): UnlockEntry[] {
  return uncoveredSlots.filter((s) => fitsSlot(resourceTypeId, s.ingredientObject));
}
