/**
 * Known professions, used as suggestions. The field stays free text, so a profession WoW Forever
 * adds is typed in once and then offered like the rest.
 */
export const PROFESSIONS = [
  'Alchemy',
  'Blacksmithing',
  'Cooking',
  'Enchanting',
  'Engineering',
  'First Aid',
  'Fishing',
  'Herbalism',
  'Leatherworking',
  'Mining',
  'Skinning',
  'Tailoring',
];

/** Known professions plus any already used on recipes, sorted. */
export function professionOptions(used: (string | null)[]): string[] {
  return [...new Set([...PROFESSIONS, ...used.filter((p): p is string => !!p)])].sort((a, b) => a.localeCompare(b));
}
