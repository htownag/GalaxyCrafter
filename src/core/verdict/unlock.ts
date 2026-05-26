// v0.1.6 UNLOCK — pure functions for slot coverage + per-resource unlock list.
//
// Coverage definition: a raw slot on an active schematic is COVERED iff
// the player owns at least one resource (in live or reserved status) whose
// type fits the slot's ingredient family. Despawned does NOT cover —
// despawned is a draining bucket, not a refill source.
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
