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
    skillGroupPrefixes: ["craftDroid"],
    description: "Combat droids, utility droids, droid components.",
  },
  {
    id: "bio_engineer",
    name: "Bio-Engineer",
    skillGroupPrefixes: ["craftBio"],
    description: "Creature enhancement, organic components.",
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
