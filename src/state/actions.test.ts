import { describe, expect, it } from 'vitest';
import type { RecipeRecord } from '../engine/types';
import { freshRepo } from '../test/db';
import { setProfession } from './actions';

const recipe = (id: string, profession: string | null, overrides: RecipeRecord['overrides'] = {}): RecipeRecord => ({
  id,
  spellId: null,
  imported: { name: id, kind: 'craft', profession, castTimeMs: 0, inputs: [], tools: [], outputs: [], outputMode: 'independent' },
  overrides,
  source: 'wowhead',
  fetchedAt: 1,
  updatedAt: 1,
  rawTooltip: null,
});

describe('setProfession (bulk edit)', () => {
  it('sets the base value, drops a profession override, and counts only real changes', async () => {
    const repo = await freshRepo();
    const recs = [recipe('a', null), recipe('b', 'Tailoring'), recipe('c', 'Tailoring', { profession: 'Alchemy', name: 'C!' })];
    recs.forEach((r) => repo.saveRecipe(r));

    expect(setProfession(repo, repo.listRecipes(), 'Tailoring')).toBe(2);
    const byId = new Map(repo.listRecipes().map((r) => [r.id, r]));
    expect(byId.get('a')!.imported.profession).toBe('Tailoring');
    expect(byId.get('c')!.overrides).toEqual({ name: 'C!' });

    expect(setProfession(repo, repo.listRecipes(), null)).toBe(3);
    expect(repo.listRecipes().every((r) => r.imported.profession === null)).toBe(true);
  });
});
