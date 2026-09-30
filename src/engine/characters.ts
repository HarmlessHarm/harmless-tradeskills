import type { Character, Recipe, SkillRange } from './types';

/**
 * What a character knows (#21). Until addon scans exist, a character knows a recipe when:
 * - it is learned from a trainer and the character's skill is at least the required skill, or
 * - the character is marked as having learned it (a recipe item, a quest, a drop).
 * Trainer recipes are assumed trained as soon as the skill allows.
 */

export type SkillColor = 'orange' | 'yellow' | 'green' | 'grey';

/** The skill-up color of a recipe at a skill level; null below its first tier or without a range. */
export function skillColor(range: SkillRange | null, skill: number): SkillColor | null {
  if (!range) return null;
  if (skill >= range.grey) return 'grey';
  if (skill >= range.green) return 'green';
  if (skill >= range.yellow) return 'yellow';
  if (range.orange !== null && skill >= range.orange) return 'orange';
  return null;
}

/**
 * - known: trained (trainer and enough skill) or marked as learned.
 * - learnable: enough skill, but learned from something other than a trainer and not marked.
 * - too-low: not enough skill yet.
 * - unknown: the recipe has no required skill or source, so we cannot tell.
 */
export type RecipeStatus = 'known' | 'learnable' | 'too-low' | 'unknown';

export interface RecipeKnowledge {
  recipe: Recipe;
  status: RecipeStatus;
  /** How a known recipe is known. */
  via: 'trainer' | 'learned' | null;
  /** Skill-up color at the character's skill. */
  color: SkillColor | null;
}

const sameProfession = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The character's skill in a profession, or null without it. */
export function professionSkill(char: Character, profession: string | null): number | null {
  if (!profession) return null;
  return char.professions.find((p) => sameProfession(p.profession, profession))?.skill ?? null;
}

/** What a character knows of one recipe. null when the recipe is not of one of its professions. */
export function recipeKnowledge(char: Character, recipe: Recipe): RecipeKnowledge | null {
  const skill = professionSkill(char, recipe.profession);
  if (skill === null) return null;
  const color = skillColor(recipe.skillRange, skill);
  const result = (status: RecipeStatus, via: RecipeKnowledge['via'] = null): RecipeKnowledge => ({ recipe, status, via, color });
  // Disenchanting is part of Enchanting itself. Its skill limits per item level are not modelled yet.
  if (recipe.kind === 'disenchant') return result('known', 'trainer');
  if (char.learned.includes(recipe.id)) return result('known', 'learned');
  if (recipe.requiredSkill === null) return result('unknown');
  if (skill < recipe.requiredSkill) return result('too-low');
  if (recipe.learnedFrom.includes('trainer')) return result('known', 'trainer');
  return result(recipe.learnedFrom.length ? 'learnable' : 'unknown');
}

/** Every recipe of the character's professions, with what it knows of each. */
export function characterRecipes(char: Character, recipes: Iterable<Recipe>): RecipeKnowledge[] {
  const out: RecipeKnowledge[] = [];
  for (const r of recipes) {
    const k = recipeKnowledge(char, r);
    if (k) out.push(k);
  }
  return out;
}

export const knows = (char: Character, recipe: Recipe) => recipeKnowledge(char, recipe)?.status === 'known';

/** The characters that know a recipe. */
export const whoKnows = (chars: Character[], recipe: Recipe) => chars.filter((c) => knows(c, recipe));
