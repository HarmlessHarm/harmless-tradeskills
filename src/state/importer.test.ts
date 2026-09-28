import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { migrate, Repo } from '../db/repo';
import { bulkImport, importRecipe } from './importer';

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
