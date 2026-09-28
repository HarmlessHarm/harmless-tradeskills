import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { migrate, Repo } from '../db/repo';
import { bulkImport, importRecipe, importVendorPrices } from './importer';

/** Serves the saved real Wowhead responses; unknown IDs get a minimal item. */
const fetcher = async (url: string) => {
  const [, type, id] = /\/wh\/(item|spell)\/(\d+)/.exec(url)!;
  const file = fileURLToPath(new URL(`../wowhead/fixtures/${type}-${id}.json`, import.meta.url));
  const body = existsSync(file) ? readFileSync(file, 'utf8') : JSON.stringify({ name: `Item ${id}`, quality: 1, tooltip: '<b>x</b>' });
  return new Response(body);
};

async function freshRepo() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  migrate(db);
  return new Repo(db);
}

describe('importer professions', () => {
  it('tags pasted recipes, including ones already imported, and keeps the tag on refresh', async () => {
    const repo = await freshRepo();
    await importRecipe(repo, 2963, { fetcher });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      const res = await bulkImport(repo, [{ type: 'spell', id: 2963 }], { force: false, profession: 'Tailoring' }, () => {});
      expect(res.skipped).toBe(1);
      expect(res.tagged).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
    const tagged = repo.listRecipes().find((r) => r.id === 'spell:2963')!;
    expect(tagged.imported.profession).toBe('Tailoring');
    expect(tagged.overrides).toEqual({});

    await importRecipe(repo, 2963, { force: true, fetcher });
    expect(repo.listRecipes().find((r) => r.id === 'spell:2963')!.imported.profession).toBe('Tailoring');
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
