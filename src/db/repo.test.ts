import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { freshRepo } from '../test/db';
import { deShuffle } from '../test/fixtures';
import type { Transaction } from '../engine/ledger';
import type { PriceSnapshot } from '../engine/snapshots';
import { DE_SEED_NOTE } from './deSeed';
import { dbKind, expectKind, exportBytes, migrate, Repo, splitLegacy } from './repo';
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
    const check = (repo: Repo) => {
      expect(repo.moveLegacyPrices()).toBe(1);
      expect(repo.listSnapshots().map((s) => [s.itemId, s.levels, s.observedAt])).toEqual([[1, [{ price: 10, qty: 1 }], 1]]);
      expect(repo.listAhMins()).toEqual(new Map());
    };

    // A user database from before the rename.
    const user = new SQL.Database();
    user.exec(`PRAGMA application_id = ${APPLICATION_ID.user}`);
    user.exec(USER_MIGRATIONS[0]);
    user.exec('PRAGMA user_version = 1');
    user.exec(insert);
    migrate(user, 'user');
    check(new Repo({ data: (await freshRepo()).data, user, prices: (await freshRepo()).prices }));

    // A legacy combined file, e.g. an old export.
    const legacy = new SQL.Database();
    LEGACY_MIGRATIONS.forEach((m) => legacy.exec(m));
    legacy.exec(`PRAGMA user_version = ${LEGACY_MIGRATIONS.length}`);
    legacy.exec(insert);
    const split = splitLegacy(legacy, (b) => new SQL.Database(b));
    check(new Repo({ ...split, prices: (await freshRepo()).prices }));
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

  it('moves old AH prices into snapshots and keeps the latest min AH price (DEC-27)', async () => {
    const SQL = await initSqlJs();
    // A personal database from before snapshots: every migration up to the move.
    const user = new SQL.Database();
    user.exec(`PRAGMA application_id = ${APPLICATION_ID.user}`);
    // Migration 3 creates ah_min_prices from price_observations.
    const before = 3;
    USER_MIGRATIONS.slice(0, before).forEach((m) => user.exec(m));
    user.exec(`PRAGMA user_version = ${before}`);
    user.exec(`INSERT INTO price_observations (item_id, ah_price, ah_min, observed_at) VALUES
      (1, 10, NULL, 1), (1, 12, 8, 2), (2, 5, NULL, 1), (3, NULL, 4, 3)`);
    migrate(user, 'user');

    const prices = (await freshRepo()).prices;
    const changed: string[] = [];
    const repo = new Repo({ data: (await freshRepo()).data, user, prices }, (k) => changed.push(k));
    expect(repo.listAhMins()).toEqual(new Map([[1, 8], [3, 4]]));
    expect(repo.moveLegacyPrices()).toBe(3);
    expect(repo.listSnapshots().map((s) => [s.itemId, s.levels[0].price, s.observedAt, s.source, s.ahType])).toEqual([
      [1, 10, 1, 'manual', 'faction'],
      [2, 5, 1, 'manual', 'faction'],
      [1, 12, 2, 'manual', 'faction'],
    ]);
    expect(user.exec(`SELECT name FROM sqlite_master WHERE name = 'price_observations'`)).toEqual([]);
    expect(changed).toContain('prices');
    expect(changed).toContain('user');
    // Nothing left to move; and moving the same old prices into a prices file that has them adds none.
    expect(repo.moveLegacyPrices()).toBe(0);
    const again = new SQL.Database();
    again.exec(`PRAGMA application_id = ${APPLICATION_ID.user}`);
    USER_MIGRATIONS.slice(0, before).forEach((m) => again.exec(m));
    again.exec(`PRAGMA user_version = ${before}`);
    again.exec(`INSERT INTO price_observations (item_id, ah_price, ah_min, observed_at) VALUES (1, 10, NULL, 1)`);
    migrate(again, 'user');
    expect(new Repo({ data: repo.data, user: again, prices }).moveLegacyPrices()).toBe(0);
    expect(repo.listSnapshots()).toHaveLength(3);
  });

  it('sets and clears min AH prices', async () => {
    const repo = await freshRepo();
    repo.setAhMin(1, 500);
    repo.setAhMin(1, 450);
    repo.setAhMin(2, 90);
    expect(repo.listAhMins()).toEqual(new Map([[1, 450], [2, 90]]));
    repo.setAhMin(1, null);
    expect(repo.listAhMins()).toEqual(new Map([[2, 90]]));
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
    repo.setAhMin(1, 1);
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

describe('flip ledger', () => {
  const tx = (uid: string, itemId: number, occurredAt: number): Transaction => ({
    uid,
    itemId,
    kind: 'buy',
    qty: 10,
    unitPrice: 500,
    fee: 0,
    ahType: 'faction',
    occurredAt,
    source: 'manual',
    note: '',
  });

  it('round trips transactions in the personal database, oldest first, once per uid', async () => {
    const changed: string[] = [];
    const repo = await freshRepo((kind) => changed.push(kind));
    expect(repo.addTransaction(tx('b', 2589, 20))).toBe(true);
    expect(repo.addTransaction({ ...tx('a', 2589, 10), kind: 'sell', qty: 4, unitPrice: 800, fee: 160, ahType: 'neutral', note: 'hi' })).toBe(true);
    expect(repo.addTransaction(tx('b', 2589, 20))).toBe(false);
    repo.addTransaction(tx('c', 4306, 30));
    expect(changed).toEqual(['user', 'user', 'user']);
    expect(repo.listTransactions(2589)).toEqual([
      { ...tx('a', 2589, 10), id: 2, kind: 'sell', qty: 4, unitPrice: 800, fee: 160, ahType: 'neutral', note: 'hi' },
      { ...tx('b', 2589, 20), id: 1 },
    ]);
    expect(repo.listTransactions()).toHaveLength(3);
    repo.deleteTransaction(1);
    expect(repo.listTransactions().map((t) => t.uid)).toEqual(['a', 'c']);
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
    expect(repo.listSnapshots()).toEqual([{ ...snap('a', 2589, 10), id: 1, owner: repo.playerId() }]);
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
    // The first snapshot also creates your player id in the personal database (DEC-28).
    expect(changed).toEqual(['user', 'prices']);
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

  it("adds another player's prices without touching yours (DEC-28)", async () => {
    const mine = await freshRepo();
    mine.addSnapshot(snap('mine-1', 2589, 10));
    mine.addSnapshot(snap('shared-1', 2589, 20));
    const theirs = await freshRepo();
    theirs.addSnapshot({ ...snap('shared-1', 2589, 20), levels: [{ price: 999, qty: 1 }] }); // same snapshot, differs: yours wins
    theirs.addSnapshot(snap('theirs-1', 2589, 30));
    theirs.addSnapshot({ ...snap('third-1', 4306, 40), origin: 'friend.sqlite' }); // they got it from someone else

    expect(mine.addSnapshotsFrom(theirs.prices, 'bob.sqlite')).toEqual({ added: 2, skipped: 1 });
    const all = mine.listSnapshots();
    expect(all.map((s) => [s.uid, s.origin])).toEqual([
      ['mine-1', undefined],
      ['shared-1', undefined],
      ['theirs-1', 'bob.sqlite'],
      ['third-1', 'friend.sqlite'],
    ]);
    expect(all.find((s) => s.uid === 'shared-1')!.levels[0].price).toBe(56);
    // The same file again adds nothing.
    expect(mine.addSnapshotsFrom(theirs.prices, 'bob.sqlite')).toEqual({ added: 0, skipped: 3 });

    expect(mine.removeAddedSnapshots()).toBe(2);
    expect(mine.listSnapshots().map((s) => s.uid)).toEqual(['mine-1', 'shared-1']);
  });

  it('restores your own backup as yours, and marks prices from before player ids as shared', async () => {
    const mine = await freshRepo();
    mine.addSnapshot(snap('mine-1', 2589, 10));
    const backup = new (await initSqlJs()).Database(mine.prices.export());
    mine.removeAddedSnapshots();
    mine.prices.exec('DELETE FROM price_snapshots');
    expect(mine.addSnapshotsFrom(backup, 'my-backup.sqlite')).toEqual({ added: 1, skipped: 0 });
    expect(mine.listSnapshots()[0]).toMatchObject({ uid: 'mine-1', owner: mine.playerId() });
    expect(mine.listSnapshots()[0].origin).toBeUndefined();
    expect(mine.removeAddedSnapshots()).toBe(0);

    // Another player's file from before ids: no owner, so not yours.
    const old = await freshRepo();
    old.addSnapshot({ ...snap('old-1', 2589, 20), owner: null });
    mine.addSnapshotsFrom(old.prices, 'old.sqlite');
    expect(mine.listSnapshots().find((s) => s.uid === 'old-1')).toMatchObject({ owner: null, origin: 'old.sqlite' });
  });

  it('claims prices recorded before player ids as yours', async () => {
    const repo = await freshRepo();
    repo.addSnapshot({ ...snap('a', 2589, 10), owner: null });
    repo.addSnapshot({ ...snap('b', 2589, 20), owner: null, origin: 'bob.sqlite' });
    repo.claimUnownedSnapshots();
    expect(repo.listSnapshots().map((s) => [s.uid, s.owner === repo.playerId()])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  it('lets each import button take only its own kind of file', () => {
    expect(() => expectKind('prices', 'prices')).not.toThrow();
    expect(() => expectKind('legacy', 'user')).not.toThrow();
    expect(() => expectKind('legacy', 'data')).not.toThrow();
    expect(() => expectKind('user', 'prices')).toThrow('This file holds personal data, not AH prices.');
    expect(() => expectKind('prices', 'data')).toThrow('This file holds AH prices, not game data.');
    expect(() => expectKind('legacy', 'prices')).toThrow(/old file/);
    expect(() => expectKind('empty', 'user')).toThrow('The file is empty');
  });

  it('keeps prices out of the game data and personal data files', async () => {
    const repo = await freshRepo();
    repo.addSnapshot(snap('a', 2589, 10));
    expect(repo.user.exec(`SELECT name FROM sqlite_master WHERE name = 'price_snapshots'`)).toEqual([]);
    expect(repo.data.exec(`SELECT name FROM sqlite_master WHERE name = 'price_snapshots'`)).toEqual([]);
  });
});

describe('split databases', () => {
  it('stores onboarding progress', async () => {
    const repo = await freshRepo();
    expect(repo.getOnboarding()).toEqual({ tours: { workflow: 'new', flip: 'new' }, active: null, read: [], completed: false });
    const saved = {
      tours: { workflow: 'new' as const, flip: 'skipped' as const },
      active: { tour: 'workflow' as const, step: 3, afterId: 0, workflowId: 7, paused: true },
      read: ['start'],
      completed: false,
    };
    repo.saveOnboarding(saved);
    expect(repo.getOnboarding()).toEqual(saved);
  });

  it('opens the game data seed at the latest schema', async () => {
    const SQL = await initSqlJs();
    const data = new SQL.Database(readFileSync(new URL('./seed/gamedata.sqlite', import.meta.url)));
    expect(dbKind(data)).toBe('data');
    migrate(data, 'data');
    const fresh = (kind: 'user' | 'prices') => {
      const db = new SQL.Database();
      migrate(db, kind);
      return db;
    };
    const repo = new Repo({ data, user: fresh('user'), prices: fresh('prices') });
    expect(repo.listRecipes().length).toBeGreaterThan(0);
    expect(repo.listItems().some((i) => i.vendorBuy !== null)).toBe(true);
    expect(repo.listDeRules().length).toBeGreaterThan(0);
    // The workflow tour builds the DE shuffle from these.
    for (const id of ['spell:2963', 'spell:3840', 'spell:25124', 'spell:14807']) expect(repo.listRecipes().some((r) => r.id === id)).toBe(true);
  });

  it('exports game data without the saved tooltips, and keeps them in the live database', async () => {
    const SQL = await initSqlJs();
    const repo = await freshRepo();
    repo.saveItem({
      id: 4307,
      imported: { name: 'Heavy Linen Gloves', quality: 2, itemLevel: 10, itemClass: 'armor', subclass: 'Cloth', vendorSell: 22, icon: null },
      overrides: {},
      vendorBuy: null,
      source: 'wowhead',
      fetchedAt: 1,
      updatedAt: 2,
      rawTooltip: '<b>x</b>',
    });
    const open = (b: Uint8Array) => new SQL.Database(b);
    const exported = new Repo({ data: open(exportBytes(repo.data, 'data', open)), user: repo.user, prices: repo.prices });
    expect(exported.listItems()[0].rawTooltip).toBeNull();
    expect(exported.listDeRules()).toHaveLength(repo.listDeRules().length);
    expect(repo.listItems()[0].rawTooltip).toBe('<b>x</b>');
  });

  it('keeps game data, personal data and prices in separate files', async () => {
    const repo = await freshRepo();
    const tables = (db: typeof repo.data) => db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)[0].values.flat();
    expect(tables(repo.data)).toEqual(['de_rules', 'items', 'recipes']);
    expect(tables(repo.user)).toEqual(['ah_min_prices', 'character_recipes', 'characters', 'flip_transactions', 'settings', 'workflows']);
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
    repo.moveLegacyPrices();
    expect(repo.listSnapshots().map((s) => s.levels[0].price)).toEqual([100]);
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

describe('characters', () => {
  it('saves characters with professions and learned recipes, and deletes them whole', async () => {
    const repo = await freshRepo();
    const base = { id: 0, name: 'Harm', realm: 'Forever', faction: 'horde' as const, level: 20, notes: '', professions: [{ profession: 'Alchemy', skill: 75 }], learned: [], updatedAt: 1 };
    const id = repo.saveCharacter(base);
    const other = repo.saveCharacter({ ...base, name: 'Alt' });
    repo.setLearned(id, 'spell:6624', true);
    repo.setLearned(id, 'spell:6624', true);
    repo.setLearned(id, 'spell:2331', true);
    repo.setLearned(other, 'spell:2331', true);
    repo.setLearned(id, 'spell:2331', false);
    expect(repo.listCharacters().map((c) => [c.name, c.learned])).toEqual([
      ['Alt', ['spell:2331']],
      ['Harm', ['spell:6624']],
    ]);
    repo.saveCharacter({ ...base, id, professions: [{ profession: 'Alchemy', skill: 90 }], updatedAt: 2 });
    expect(repo.listCharacters().find((c) => c.id === id)).toMatchObject({ professions: [{ profession: 'Alchemy', skill: 90 }], faction: 'horde', level: 20 });
    repo.deleteCharacter(id);
    expect(repo.listCharacters().map((c) => c.name)).toEqual(['Alt']);
    repo.saveCharacter({ ...base, name: 'New' });
    expect(repo.listCharacters().find((c) => c.name === 'New')!.learned).toEqual([]);
  });
});
