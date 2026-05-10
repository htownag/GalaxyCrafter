// Resource-type → schematic-slot compatibility resolver.
//
// A slot's `ingredientObject` for raw-resource slots (ingredientType=0) is
// either:
//   - a specific resource type ID (e.g. "aluminum_phrik")    — direct match
//   - a group ID (e.g. "aluminum")                            — match via typegroup
//
// We don't distinguish at the schema level; the resolver tries both. The
// type-ancestor map is built once from `resource_type_groups` rows and
// reused across the scoring pass.

/**
 * Build a `typeId → Set<ancestorGroupId>` lookup from the edge list.
 * Single pass over the (small) edge table; allocated once per recompute.
 */
export function buildTypeAncestorMap(
  edges: ReadonlyArray<{ typeId: string; groupId: string }>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const e of edges) {
    let set = map.get(e.typeId);
    if (!set) {
      set = new Set();
      map.set(e.typeId, set);
    }
    set.add(e.groupId);
  }
  return map;
}

/**
 * Does the given resource type fit a raw-resource slot?
 *
 * Two cases:
 *  1. Direct type ID match (`ingredientObject === resourceTypeId`).
 *  2. Group ancestor match (the resource's type lists `ingredientObject`
 *     as one of its ancestors in the typegroup edge table).
 *
 * Type 1 / type 3 slots (specific / base-class components) are NOT raw-
 * resource compatible — they want crafted sub-component items. Callers
 * should pre-filter to ingredientType === 0 before invoking.
 */
export function resourceTypeFitsRawSlot(
  resourceTypeId: string,
  ingredientObject: string,
  typeAncestors: Map<string, Set<string>>,
): boolean {
  if (resourceTypeId === ingredientObject) return true;
  return typeAncestors.get(resourceTypeId)?.has(ingredientObject) ?? false;
}
