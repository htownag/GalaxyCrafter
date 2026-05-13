// Canonical crafting professions. Used in profession_priorities and to
// classify schematics by skill group prefix.

export interface ProfessionDef {
  id: string; // 'weaponsmith'
  name: string; // 'Weaponsmith'
  skillGroupPrefixes: string[]; // matches schematic.skillGroup for profession tagging
  description?: string;
}

export const PROFESSIONS: ProfessionDef[] = [
  {
    id: "artisan",
    name: "Artisan",
    skillGroupPrefixes: ["craftArtisan"],
    description: "Base crafter; harvests, surveys, makes tools and basic components.",
  },
  {
    id: "weaponsmith",
    name: "Weaponsmith",
    skillGroupPrefixes: ["craftWeapon"],
    description: "Weapons of all types, weapon components.",
  },
  {
    id: "armorsmith",
    name: "Armorsmith",
    skillGroupPrefixes: ["craftArmor"],
    description: "Body armor, segments, layers.",
  },
  {
    id: "architect",
    name: "Architect",
    skillGroupPrefixes: ["craftArchitect", "craftStructure"],
    description: "Houses, factories, harvesters, civic structures.",
  },
  {
    id: "chef",
    name: "Chef",
    skillGroupPrefixes: ["craftChef", "craftFood"],
    description: "Food, drink, spice — stat-buff consumables.",
  },
  {
    id: "tailor",
    name: "Tailor",
    skillGroupPrefixes: ["craftTailor", "craftClothing"],
    description: "Clothing, jewellery, hats.",
  },
  {
    id: "droid_engineer",
    name: "Droid Engineer",
    // Both casings — the GH dataset is inconsistent: some droid schematics
    // use `craftDroid*` (capital), others use `craftdroid*` / `craftdroidgenmod*` /
    // `craftdroiddefmod*` (lowercase). Without the lowercase prefixes ~70
    // droid schematics fall through to profession=null and never get scored.
    // Fixed 2026-05-13.
    skillGroupPrefixes: ["craftDroid", "craftdroid"],
    description: "Combat droids, utility droids, droid components, droid modules.",
  },
  {
    id: "bio_engineer",
    name: "Bio-Engineer",
    skillGroupPrefixes: ["craftBio", "craftTissue", "craftBasicTissue", "craftAdvancedTissue"],
    description: "Creature enhancement, tissue grafts, organic components.",
  },
  {
    id: "doctor",
    name: "Doctor",
    // Medic + Combat Medic schematics in NGE share the same crafting tree.
    // Covers stimpacks, wound + state medpacks, area cures, and the offensive
    // poison / disease delivery units Combat Medics build. medicineComponent
    // groups produce the sub-component reagents.
    skillGroupPrefixes: [
      "craftMedicine",
      "craftMedpack",
      "craftStimpack",
      "craftCureDisease",
      "craftCurePoison",
      "craftApplyPoison",
      "craftApplyDisease",
    ],
    description: "Stimpacks, medpacks, wound + state cures, combat-medic delivery units.",
  },
  {
    id: "jedi",
    name: "Jedi",
    // Lightsaber generations (1-4, one-hand / two-hand / polearm) + the
    // crafting toolkit + refined crystal pack. SR2's Jedi village /
    // padawan-tree schematics route through these prefixes.
    skillGroupPrefixes: ["craftSaber", "craftJedi"],
    description: "Lightsabers, lightsaber components, crystal refinement.",
  },
];

export type ProfessionTier = "primary" | "secondary" | "ignored";

export const PROFESSION_TIERS: ProfessionTier[] = ["primary", "secondary", "ignored"];

/** Best-effort: derive the profession id from a schematic's skillGroup. */
export function professionForSkillGroup(skillGroup: string | null | undefined): string | null {
  if (!skillGroup) return null;
  for (const p of PROFESSIONS) {
    for (const prefix of p.skillGroupPrefixes) {
      if (skillGroup.startsWith(prefix)) return p.id;
    }
  }
  return null;
}
