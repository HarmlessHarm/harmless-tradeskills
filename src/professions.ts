import type { RecipeSource, SkillRange } from './engine/types';

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

export const SOURCE_LABELS: Record<RecipeSource, string> = {
  trainer: 'Trainer',
  vendor: 'Vendor',
  drop: 'Drop',
  quest: 'Quest',
  other: 'Other',
};

export const learnedFromText = (sources: RecipeSource[]) => sources.map((s) => SOURCE_LABELS[s]).join(', ');

/** "25 / 65 / 85 / 105", orange first; tiers the recipe does not have are left out. */
export const skillRangeText = (r: SkillRange) => [r.orange, r.yellow, r.green, r.grey].filter((n) => n !== null).join(' / ');
