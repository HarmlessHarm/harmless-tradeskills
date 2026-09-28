import { describe, expect, it } from 'vitest';
import { engineData, IDS } from '../test/fixtures';
import { searchRecipes } from './recipeSearch';

describe('recipe search', () => {
  const { recipes, items } = engineData();
  const all = [...recipes.values()];
  const names = (q: string) => searchRecipes(all, items, q).map((m) => m.recipe.name);

  it('finds recipes by name', () => {
    expect(names('gloves')).toEqual(['Heavy Linen Gloves']);
  });
  it('finds recipes by reagent or product and reports the matched item', () => {
    expect(names('maple')).toEqual(['Minor Wizard Oil']);
    expect(searchRecipes(all, items, 'essence')[0].matchedItems).toEqual([IDS.lme]);
  });
  it('ranks name matches before reagent matches', () => {
    // "Heavy Linen Gloves" only uses bolts, so it follows the recipe named after them.
    expect(names('bolt')).toEqual(['Bolt of Linen Cloth', 'Heavy Linen Gloves']);
    expect(names('linen')).toEqual(['Bolt of Linen Cloth', 'Heavy Linen Gloves']);
  });
  it('requires every term to match somewhere', () => {
    expect(names('wand wood')).toEqual(['Greater Magic Wand']);
    expect(names('wand vial')).toEqual([]);
  });
  it('lists everything for an empty query', () => {
    expect(names('')).toHaveLength(all.length);
  });
  it('lists preferred recipes first', () => {
    const wand = all.find((r) => r.name === 'Greater Magic Wand')!;
    expect(searchRecipes(all, items, '', { preferred: new Set([wand.id]) })[0].recipe).toBe(wand);
    expect(names('bolt')[0]).toBe('Bolt of Linen Cloth');
    const gloves = all.find((r) => r.name === 'Heavy Linen Gloves')!;
    expect(searchRecipes(all, items, 'bolt', { preferred: new Set([gloves.id]) }).map((m) => m.recipe.name)).toEqual(['Heavy Linen Gloves', 'Bolt of Linen Cloth']);
  });
});
