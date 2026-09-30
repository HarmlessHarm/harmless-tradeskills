import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freshRepo } from '../test/db';
import { bulkImport, importItem, importRecipe, importVendorPrices } from './importer';

/** Serves the saved real Wowhead responses; unknown IDs get a minimal item. */
const fetcher = async (url: string) => {
  const [, type, id] = /\/wh\/(item|spell)\/(\d+)/.exec(url)!;
  const file = fileURLToPath(new URL(`../wowhead/fixtures/${type}-${id}.json`, import.meta.url));
  const body = existsSync(file) ? readFileSync(file, 'utf8') : JSON.stringify({ name: `Item ${id}`, quality: 1, tooltip: '<b>x</b>' });
  return new Response(body);
};

describe('importer learning info', () => {
  it('stores pasted profession, skill and source on recipes already imported, and keeps them on refresh', async () => {
    const repo = await freshRepo();
    await importRecipe(repo, 2963, { fetcher });
    const row = { spellId: 2963, profession: 'Tailoring', requiredSkill: 1, learnedFrom: ['trainer' as const], skillRange: { orange: 1, yellow: 25, green: 37, grey: 50 } };
    const res = await bulkImport(repo, [{ type: 'spell', id: 2963 }], { force: false, recipeRows: [row], fetcher }, () => {});
    expect(res.learning).toBe(1);
    const expected = { profession: 'Tailoring', requiredSkill: 1, learnedFrom: ['trainer'], skillRange: row.skillRange };
    expect(repo.listRecipes()[0].imported).toMatchObject(expected);
    expect(repo.listRecipes()[0].overrides).toEqual({});

    const again = await bulkImport(repo, [{ type: 'spell', id: 2963 }], { force: false, recipeRows: [row], fetcher }, () => {});
    expect(again.learning).toBe(0);
    await importRecipe(repo, 2963, { force: true, fetcher });
    expect(repo.listRecipes()[0].imported).toMatchObject(expected);
  });
});

describe('bulkImport progress', () => {
  it('counts only new refs and advances when a recipe brings in pasted items', async () => {
    const repo = await freshRepo();
    await importItem(repo, 10940, { fetcher });
    // Bolt of Linen Cloth (2996) and Linen Cloth (2589) are new, but come with the recipe.
    const refs = [
      { type: 'spell' as const, id: 2963 },
      { type: 'item' as const, id: 2996 },
      { type: 'item' as const, id: 2589 },
      { type: 'item' as const, id: 10940 },
    ];
    const progress: [number, number][] = [];
    const res = await bulkImport(repo, refs, { force: false, fetcher }, (d, t) => progress.push([d, t]));
    expect(progress).toEqual([
      [0, 3],
      [3, 3],
    ]);
    expect(res).toMatchObject({ imported: 3, skipped: 1, errors: [] });
  });
});

describe('importVendorPrices', () => {
  it('sets vendor buy prices, importing items that are missing', async () => {
    const repo = await freshRepo();
    await importRecipe(repo, 2963, { fetcher });
    const known = repo.listItems()[0];
    repo.saveItem({ ...known, vendorBuy: 50 });
    const res = await importVendorPrices(
      repo,
      [
        { itemId: known.id, price: 50 },
        { itemId: 999_001, price: 1234 },
      ],
      () => {},
      fetcher,
    );
    expect(res).toEqual({ updated: 1, unchanged: 1, imported: 1, errors: [] });
    expect(repo.listItems().find((i) => i.id === 999_001)!.vendorBuy).toBe(1234);
    expect(repo.listItems().find((i) => i.id === known.id)!.vendorBuy).toBe(50);
  });
  it('fills in a pasted type only where the item has none', async () => {
    const repo = await freshRepo();
    await importVendorPrices(
      repo,
      [
        { itemId: 999_002, price: 10, type: 'Trade Good', classId: 7 },
        { itemId: 4307, price: 10, type: 'Something Else', classId: 4 },
      ],
      () => {},
      fetcher,
    );
    const items = repo.listItems();
    expect(items.find((i) => i.id === 999_002)!.imported).toMatchObject({ itemClass: 'other', subclass: 'Trade Good' });
    // Heavy Linen Gloves: the tooltip already says Cloth armor.
    expect(items.find((i) => i.id === 4307)!.imported).toMatchObject({ itemClass: 'armor', subclass: 'Cloth' });
  });
});
