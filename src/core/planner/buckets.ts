// Resource-bucket classification.
//
// The planner deals in three coarse buckets — mineral / chemical / energy —
// driven by SWG harvester archetypes (Ryan's v1 scope). A resource falls in
// the bucket whose root group appears in the resource's type→group ancestor
// list:
//
//   mineral  ← ancestors include 'mineral'   (top-3 under inorganic)
//   chemical ← ancestors include 'chemical'  (top-3 under inorganic)
//   energy   ← ancestors include 'energy'    (top-2 root, covers
//                                            energy_renewable for wind/solar)
//
// Out of v1: water, gas, organic (creature/flora). Returning null for
// those means the planner won't recommend a harvester for them — the
// player can still harvest manually or via the unbundled flora/water
// harvesters, just not through the planner's recommendation list.

import type { HarvesterBucket } from "./harvesters";

/**
 * Classify a resource into a harvester bucket from its type→group ancestor set.
 *
 * @param typeAncestors  the resource type's full ancestor list, including
 *                       the type itself + every group up to the 'resource'
 *                       root. Pre-built via the existing
 *                       `buildTypeAncestorMap` helper in core/verdict/compat.
 */
export function resourceBucket(typeAncestors: ReadonlySet<string>): HarvesterBucket | null {
  if (typeAncestors.has("mineral")) return "mineral";
  if (typeAncestors.has("chemical")) return "chemical";
  if (typeAncestors.has("energy")) return "energy";
  return null;
}
