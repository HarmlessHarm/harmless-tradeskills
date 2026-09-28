import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { deShuffle } from '../test/fixtures';
import { migrate, Repo } from './repo';

async function freshRepo() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  migrate(db);
  return new Repo(db);
}

describe('repo', () => {
  it('migrates idempotently and seeds starter DE rules', async () => {
    const repo = await freshRepo();
    migrate(repo.db);
    expect(repo.listDeRules()).toHaveLength(2);
  });

  it('round trips items with overrides', async () => {
    const repo = await freshRepo();
    const rec = {
      id: 4307,
      imported: { name: 'Heavy Linen Gloves', quality: 2 as const, itemLevel: 10, itemClass: 'armor' as const, subclass: 'Cloth', vendorSell: 22, icon: null },
      overrides: { vendorSell: 25 },
      vendorBuy: null,
      source: 'wowhead' as const,
      fetchedAt: 1,
      updatedAt: 2,
      rawTooltip: '<b>x</b>',
    };
    repo.saveItem(rec);
    repo.saveItem({ ...rec, updatedAt: 3 });
    expect(repo.listItems()).toEqual([{ ...rec, updatedAt: 3 }]);
  });

  it('keeps price history and returns the latest', async () => {
    const repo = await freshRepo();
    repo.addPrice({ itemId: 1, ahPrice: 10, ahPessimistic: null, observedAt: 1 });
    repo.addPrice({ itemId: 1, ahPrice: 12, ahPessimistic: 8, observedAt: 2 });
    repo.addPrice({ itemId: 2, ahPrice: 5, ahPessimistic: null, observedAt: 1 });
    const latest = repo.latestPrices().sort((a, b) => a.itemId - b.itemId);
    expect(latest).toEqual([
      { itemId: 1, ahPrice: 12, ahPessimistic: 8, observedAt: 2 },
      { itemId: 2, ahPrice: 5, ahPessimistic: null, observedAt: 1 },
    ]);
  });

  it('saves and updates workflows', async () => {
    const repo = await freshRepo();
    const id = repo.saveWorkflow({ ...deShuffle, id: 0 });
    expect(repo.listWorkflows()[0]).toEqual({ ...deShuffle, id });
    repo.saveWorkflow({ ...deShuffle, id, name: 'Renamed' });
    expect(repo.listWorkflows()).toHaveLength(1);
    expect(repo.listWorkflows()[0].name).toBe('Renamed');
  });

  it('allocates local recipe ids', async () => {
    const repo = await freshRepo();
    expect(repo.nextLocalRecipeId()).toBe('local:1');
  });

  it('stores config with defaults filled in', async () => {
    const repo = await freshRepo();
    expect(repo.getConfig()).toEqual(DEFAULT_CONFIG);
    repo.saveConfig({ ...DEFAULT_CONFIG, defaultBatchSize: 50 });
    expect(repo.getConfig().defaultBatchSize).toBe(50);
  });

  it('calls onChange after writes', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    migrate(db);
    let n = 0;
    const repo = new Repo(db, () => n++);
    repo.addPrice({ itemId: 1, ahPrice: 1, ahPessimistic: null, observedAt: 1 });
    expect(n).toBe(1);
  });

  it('round trips flip favorites', async () => {
    const repo = await freshRepo();
    expect(repo.listFlipFavorites()).toEqual([]);
    const favs = [{ itemId: 4306, buyPrice: 500, sellPrice: null, durationKey: '8h', ahType: 'neutral' as const }];
    repo.saveFlipFavorites(favs);
    expect(repo.listFlipFavorites()).toEqual(favs);
  });
});
