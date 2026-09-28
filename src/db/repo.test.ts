import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { freshRepo } from '../test/db';
import { deShuffle } from '../test/fixtures';
import type { PriceSnapshot } from '../engine/snapshots';
import { DE_SEED_NOTE } from './deSeed';
import { dbKind, migrate, Repo, splitLegacy } from './repo';
import { APPLICATION_ID, LEGACY_MIGRATIONS, USER_MIGRATIONS } from './schema';

describe('repo', () => {
  it('migrates idempotently and seeds the Classic DE table', async () => {
    const repo = await freshRepo();
    migrate(repo.data, 'data');
    migrate(repo.user, 'user');
    const rules = repo.listDeRules();
    // 11 green, 8 rare and 5 epic bands, each for armor and weapons.
    expect(rules).toHaveLength(48);
    for (const r of rules) expect(r.outputs.reduce((s, o) => s + o.chance, 0)).toBeCloseTo(1, 6);
    const green20 = rules.find((r) => r.quality === 2 && r.itemClass === 'armor' && r.ilvlMin <= 20 && r.ilvlMax >= 20);
    expect(green20?.outputs).toEqual([
      { itemId: 10940, chance: 0.75, minQty: 2, maxQty: 3 },
      { itemId: 10939, chance: 0.2, minQty: 1, maxQty: 2 },
      { itemId: 10978, chance: 0.05, minQty: 1, maxQty: 1 },
    ]);
  });

  it('seeding the DE table keeps rules the user edited', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.exec(LEGACY_MIGRATIONS[0]);
    db.exec('PRAGMA user_version = 1');
    // User edited the armor starter rule; the weapon one is untouched.
    db.exec(`UPDATE de_rules SET notes = 'mine' WHERE item_class = 'armor'`);
    const { data, user } = splitLegacy(db, (b) => new SQL.Database(b));
    const rules = new Repo({ data, user, prices: (await freshRepo()).prices }).listDeRules();
    const low = rules.filter((r) => r.quality === 2 && r.ilvlMin <= 15);
    expect(low.map((r) => [r.itemClass, r.ilvlMin, r.notes])).toEqual([
      ['armor', 5, 'mine'],
      ['weapon', 1, DE_SEED_NOTE],
    ]);
    expect(rules).toHaveLength(48);
  });

  it('drops old pessimistic prices when upgrading to min AH prices', async () => {
    const SQL = await initSqlJs();
    const insert = 'INSERT INTO price_observations (item_id, ah_price, ah_pessimistic, observed_at) VALUES (1, 10, 8, 1)';
    const expected = [{ itemId: 1, ahPrice: 10, ahMin: null, observedAt: 1 }];

    // A user database from before the rename.
    const user = new SQL.Database();
    user.exec(`PRAGMA application_id = ${APPLICATION_ID.user}`);
    user.exec(USER_MIGRATIONS[0]);
    user.exec('PRAGMA user_version = 1');
    user.exec(insert);
    migrate(user, 'user');
    const fresh = await freshRepo();
    expect(new Repo({ data: fresh.data, user, prices: fresh.prices }).latestPrices()).toEqual(expected);

    // A legacy combined file, e.g. an old export.
    const legacy = new SQL.Database();
    LEGACY_MIGRATIONS.forEach((m) => legacy.exec(m));
    legacy.exec(`PRAGMA user_version = ${LEGACY_MIGRATIONS.length}`);
    legacy.exec(insert);
    const split = splitLegacy(legacy, (b) => new SQL.Database(b));
    expect(new Repo({ ...split, prices: fresh.prices }).latestPrices()).toEqual(expected);
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
    repo.addPrice({ itemId: 1, ahPrice: 10, ahMin: null, observedAt: 1 });
    repo.addPrice({ itemId: 1, ahPrice: 12, ahMin: 8, observedAt: 2 });
    repo.addPrice({ itemId: 2, ahPrice: 5, ahMin: null, observedAt: 1 });
    const latest = repo.latestPrices().sort((a, b) => a.itemId - b.itemId);
    expect(latest).toEqual([
      { itemId: 1, ahPrice: 12, ahMin: 8, observedAt: 2 },
      { itemId: 2, ahPrice: 5, ahMin: null, observedAt: 1 },
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

  it('calls onChange with the database that changed', async () => {
    const changed: string[] = [];
    const repo = await freshRepo((kind) => changed.push(kind));
    repo.addPrice({ itemId: 1, ahPrice: 1, ahMin: null, observedAt: 1 });
    repo.deleteItem(1);
    expect(changed).toEqual(['user', 'data']);
  });

  it('round trips flip favorites', async () => {
    const repo = await freshRepo();
    expect(repo.listFlipFavorites()).toEqual([]);
    const favs = [{ itemId: 4306, buyPrice: 500, sellPrice: null, durationKey: '8h', ahType: 'neutral' as const }];
    repo.saveFlipFavorites(favs);
    expect(repo.listFlipFavorites()).toEqual(favs);
  });
});

describe('price snapshots', () => {
  const snap = (uid: string, itemId: number, observedAt: number): PriceSnapshot => ({
    uid,
    itemId,
    observedAt,
    ahType: 'faction',
    source: 'manual',
    totalQty: 3000,
    levels: [
      { price: 56, qty: 100 },
      { price: 58, qty: 450 },
    ],
    truncated: true,
  });

  it('round trips snapshots and stores the derived stats', async () => {
    const repo = await freshRepo();
    expect(repo.addSnapshot(snap('a', 2589, 10))).toBe(true);
    expect(repo.listSnapshots()).toEqual([{ ...snap('a', 2589, 10), id: 1 }]);
    const row = repo.prices.exec('SELECT min_price, min_qty, market_value, confidence FROM price_snapshots')[0].values[0];
    // 15% of 3000 = 450 units is reached in the 58c row, which is taken whole (under 30%).
    expect(row).toEqual([56, 100, Math.round((100 * 56 + 450 * 58) / 550), 'solid']);
  });

  it('stores a snapshot once, however often it is imported', async () => {
    const changed: string[] = [];
    const repo = await freshRepo((kind) => changed.push(kind));
    expect(repo.addSnapshot(snap('a', 2589, 10))).toBe(true);
    expect(repo.addSnapshot(snap('a', 2589, 10))).toBe(false);
    expect(repo.listSnapshots()).toHaveLength(1);
    expect(changed).toEqual(['prices']);
  });

  it('filters by item and time, oldest first', async () => {
    const repo = await freshRepo();
    repo.addSnapshot(snap('c', 2589, 30));
    repo.addSnapshot(snap('a', 2589, 10));
    repo.addSnapshot(snap('b', 4306, 20));
    expect(repo.listSnapshots({ itemId: 2589 }).map((s) => s.uid)).toEqual(['a', 'c']);
    expect(repo.listSnapshots({ since: 20 }).map((s) => s.uid)).toEqual(['b', 'c']);
    repo.deleteSnapshot(repo.listSnapshots({ itemId: 4306 })[0].id!);
    expect(repo.listSnapshots().map((s) => s.uid)).toEqual(['a', 'c']);
  });

  it('keeps prices out of the game data and personal data files', async () => {
    const repo = await freshRepo();
    repo.addSnapshot(snap('a', 2589, 10));
    expect(repo.user.exec(`SELECT name FROM sqlite_master WHERE name = 'price_snapshots'`)).toEqual([]);
    expect(repo.data.exec(`SELECT name FROM sqlite_master WHERE name = 'price_snapshots'`)).toEqual([]);
  });
});

describe('split databases', () => {
  it('keeps game data, personal data and prices in separate files', async () => {
    const repo = await freshRepo();
    const tables = (db: typeof repo.data) => db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)[0].values.flat();
    expect(tables(repo.data)).toEqual(['de_rules', 'items', 'recipes']);
    expect(tables(repo.user)).toEqual(['price_observations', 'settings', 'workflows']);
    expect(tables(repo.prices)).toEqual(['price_snapshots']);
    expect(dbKind(repo.data)).toBe('data');
    expect(dbKind(repo.user)).toBe('user');
    expect(dbKind(repo.prices)).toBe('prices');
    expect(() => migrate(repo.prices, 'user')).toThrow(/Expected a user database, got prices/);
    expect(() => migrate(repo.data, 'user')).toThrow(/Expected a user database/);
  });

  it('splits a legacy combined file, keeping every row', async () => {
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    for (const [i, m] of LEGACY_MIGRATIONS.entries()) {
      legacy.exec(m);
      legacy.exec(`PRAGMA user_version = ${i + 1}`);
    }
    legacy.exec(`INSERT INTO items (id, imported, source, updated_at) VALUES (4306, '{"name":"Silk Cloth"}', 'wowhead', 1)`);
    legacy.exec(`INSERT INTO workflows (name, steps, updated_at, target_gph) VALUES ('Shuffle', '[]', 1, 5000)`);
    legacy.exec(`INSERT INTO settings (key, value) VALUES ('flipFavorites', '[{"itemId":4306}]')`);
    legacy.exec(`INSERT INTO price_observations (item_id, ah_price, observed_at) VALUES (4306, 100, 1)`);
    expect(dbKind(legacy)).toBe('legacy');

    const { data, user } = splitLegacy(new SQL.Database(legacy.export()), (b) => new SQL.Database(b));
    const prices = new SQL.Database();
    migrate(prices, 'prices');
    const repo = new Repo({ data, user, prices });
    expect(repo.listItems().map((i) => i.id)).toEqual([4306]);
    expect(repo.listDeRules()).toHaveLength(48);
    expect(repo.listWorkflows().map((w) => [w.name, w.targetGoldPerHour])).toEqual([['Shuffle', 5000]]);
    expect(repo.listFlipFavorites()).toEqual([{ itemId: 4306 }]);
    expect(repo.latestPrices().map((p) => p.ahPrice)).toEqual([100]);
    expect(data.exec(`SELECT name FROM sqlite_master WHERE name = 'workflows'`)).toEqual([]);
    expect(user.exec(`SELECT name FROM sqlite_master WHERE name = 'items'`)).toEqual([]);

    // The split files survive a round trip and are recognised by kind.
    expect(dbKind(new SQL.Database(data.export()))).toBe('data');
    expect(dbKind(new SQL.Database(user.export()))).toBe('user');
  });

  it('rejects files that are not ours', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.exec('CREATE TABLE foo (x)');
    expect(() => dbKind(db)).toThrow(/Not a Harmless Tradeskills database/);
  });
});
