import { describe, expect, it } from 'vitest';
import { recipes } from '../test/fixtures';
import { characterRecipes, recipeKnowledge, skillColor, whoKnows } from './characters';
import type { Character, Recipe } from './types';

const char = (professions: [string, number][], learned: string[] = [], name = 'Harm'): Character => ({
  id: 1,
  name,
  ruleset: null,
  faction: null,
  level: null,
  notes: '',
  professions: professions.map(([profession, skill]) => ({ profession, skill })),
  learned,
  updatedAt: 0,
});

const recipe = (id: string, patch: Partial<Recipe>): Recipe => ({ ...recipes[0], id, profession: 'Alchemy', ...patch });
const sulfuric = recipe('spell:1', { requiredSkill: 50, learnedFrom: ['trainer'], skillRange: { orange: null, yellow: 50, green: 70, grey: 90 } });
const freeAction = recipe('spell:2', { requiredSkill: 150, learnedFrom: ['vendor'], skillRange: { orange: 150, yellow: 175, green: 195, grey: 215 } });
const manaWell = recipe('spell:3', { requiredSkill: 20, learnedFrom: ['quest', 'trainer'], skillRange: null });
const noData = recipe('spell:4', {});

describe('skillColor', () => {
  it('picks the highest tier reached', () => {
    const r = { orange: 80, yellow: 80, green: 90, grey: 100 };
    expect(skillColor(r, 79)).toBeNull();
    expect(skillColor(r, 80)).toBe('yellow');
    expect(skillColor(r, 95)).toBe('green');
    expect(skillColor(r, 300)).toBe('grey');
    expect(skillColor(freeAction.skillRange, 160)).toBe('orange');
  });
  it('skips tiers a recipe does not have', () => {
    const twoTiers = { orange: 145, yellow: null, green: null, grey: 170 };
    expect(skillColor(twoTiers, 144)).toBeNull();
    expect(skillColor(twoTiers, 160)).toBe('orange');
    expect(skillColor(twoTiers, 170)).toBe('grey');
  });
  it('has no orange for a recipe that starts at yellow', () => {
    expect(skillColor(sulfuric.skillRange, 49)).toBeNull();
    expect(skillColor(sulfuric.skillRange, 50)).toBe('yellow');
  });
});

describe('recipeKnowledge', () => {
  it('trains trainer recipes as soon as the skill allows', () => {
    expect(recipeKnowledge(char([['Alchemy', 49]]), sulfuric)?.status).toBe('too-low');
    expect(recipeKnowledge(char([['Alchemy', 50]]), sulfuric)).toMatchObject({ status: 'known', via: 'trainer', color: 'yellow' });
    expect(recipeKnowledge(char([['Alchemy', 20]]), manaWell)).toMatchObject({ status: 'known', via: 'trainer', color: null });
  });
  it('needs other recipes marked as learned', () => {
    expect(recipeKnowledge(char([['Alchemy', 160]]), freeAction)).toMatchObject({ status: 'learnable', color: 'orange' });
    expect(recipeKnowledge(char([['Alchemy', 160]], ['spell:2']), freeAction)).toMatchObject({ status: 'known', via: 'learned' });
  });
  it('says unknown when the recipe has no skill or source, unless it is marked', () => {
    expect(recipeKnowledge(char([['Alchemy', 300]]), noData)?.status).toBe('unknown');
    expect(recipeKnowledge(char([['Alchemy', 300]], ['spell:4']), noData)?.status).toBe('known');
  });
  it('ignores recipes of other professions and matches names loosely', () => {
    expect(recipeKnowledge(char([['Tailoring', 300]]), sulfuric)).toBeNull();
    expect(recipeKnowledge(char([['alchemy ', 300]]), sulfuric)?.status).toBe('known');
  });
  it('knows disenchanting with Enchanting', () => {
    const de = recipe('de:1', { kind: 'disenchant', profession: 'Enchanting' });
    expect(recipeKnowledge(char([['Enchanting', 1]]), de)?.status).toBe('known');
  });
});

describe('characterRecipes and whoKnows', () => {
  it('lists the recipes of the character professions and who knows one', () => {
    const a = char([['Alchemy', 60]], [], 'A');
    const b = char([['Alchemy', 10]], [], 'B');
    expect(characterRecipes(a, [sulfuric, freeAction, recipe('spell:9', { profession: 'Tailoring' })]).map((k) => [k.recipe.id, k.status])).toEqual([
      ['spell:1', 'known'],
      ['spell:2', 'too-low'],
    ]);
    expect(whoKnows([a, b], sulfuric).map((c) => c.name)).toEqual(['A']);
  });
});
