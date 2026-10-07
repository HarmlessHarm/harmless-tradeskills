import type { Database, SqlValue } from 'sql.js';
import { withDefaults } from '../config';
import type {
  Character,
  Config,
  Copper,
  DisenchantRule,
  FavorCrate,
  FlipFavorite,
  ItemRecord,
  RecipeRecord,
  Workflow,
} from '../engine/types';
import type { Transaction, TransactionKind, TransactionSource } from '../engine/ledger';
import { type PriceLevel, type PriceSnapshot, type SnapshotSource, summarize } from '../engine/snapshots';
import {
  APPLICATION_ID,
  DATA_MIGRATIONS,
  type DbKind,
  LEGACY_KINDS,
  LEGACY_MIGRATIONS,
  type LegacyKind,
  PRICES_MIGRATIONS,
  SPLIT_VERSION,
  TABLES,
  USER_MIGRATIONS,
} from './schema';

export type { DbKind };
export type Dbs = Record<DbKind, Database>;

type Row = Record<string, SqlValue>;

export type TourId = 'workflow' | 'flip';
export type TourStatus = 'new' | 'done' | 'skipped';

/** Where a new user is in the guided tours. Stored in personal data, so a reload picks up the tour again. */
export interface Onboarding {
  tours: Record<TourId, TourStatus>;
  /** The tour being followed, if any. */
  active: {
    tour: TourId;
    step: number;
    /** Workflow tour: workflows with a higher id were made during the tour. */
    afterId: number;
    /** Workflow tour: the workflow the user made in it, once they press New. */
    workflowId: number | null;
    /** Hidden for now; continued from Get started. */
    paused?: boolean;
  } | null;
  /** Read-only Get started steps the user marked as read. */
  read: string[];
  /** The user finished the Get started walkthrough. */
  completed: boolean;
}

export const NEW_ONBOARDING: Onboarding = { tours: { workflow: 'new', flip: 'new' }, active: null, read: [], completed: false };

const json = <T>(v: SqlValue, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const num = (v: SqlValue): number | null => (v === null || v === undefined ? null : Number(v));
const pragma = (db: Database, name: string) => Number(db.exec(`PRAGMA ${name}`)[0]?.values[0][0] ?? 0);
const tables = (db: Database) => new Set((db.exec(`SELECT name FROM sqlite_master WHERE type = 'table'`)[0]?.values ?? []).map((r) => String(r[0])));

const MIGRATIONS: Record<DbKind, string[]> = { data: DATA_MIGRATIONS, user: USER_MIGRATIONS, prices: PRICES_MIGRATIONS };
export const KINDS: DbKind[] = ['data', 'user', 'prices'];

function runMigrations(db: Database, migrations: string[]): void {
  for (let v = pragma(db, 'user_version'); v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** What a database file holds: one of the kinds, a legacy combined file, or nothing yet. */
export function dbKind(db: Database): DbKind | 'legacy' | 'empty' {
  const appId = pragma(db, 'application_id');
  const kind = KINDS.find((k) => APPLICATION_ID[k] === appId);
  if (kind) return kind;
  if (appId === 0) {
    const t = tables(db);
    if (t.size === 0) return 'empty';
    if (t.has('items') && t.has('workflows')) return 'legacy';
  }
  throw new Error('Not a Harmless Tradeskills database');
}

/** Creates or updates a database of the given kind. Throws if the file is of another kind. */
export function migrate(db: Database, kind: DbKind): void {
  const found = dbKind(db);
  if (found === 'empty') db.exec(`PRAGMA application_id = ${APPLICATION_ID[kind]}`);
  else if (found !== kind) throw new Error(`Expected a ${kind} database, got ${found}`);
  runMigrations(db, MIGRATIONS[kind]);
}

/**
 * Splits a legacy combined database into a data and a user database, each migrated to the latest
 * version. The legacy file predates the prices database, so there is none to split off.
 * `open` creates a database from bytes (sql.js `new SQL.Database(bytes)`).
 */
export function splitLegacy(legacy: Database, open: (bytes: Uint8Array) => Database): Pick<Dbs, LegacyKind> {
  runMigrations(legacy, LEGACY_MIGRATIONS);
  const bytes = legacy.export();
  const split = (kind: LegacyKind): Database => {
    const db = open(bytes);
    for (const other of LEGACY_KINDS.filter((k) => k !== kind)) for (const t of TABLES[other]) db.exec(`DROP TABLE ${t}`);
    db.exec(`PRAGMA user_version = ${SPLIT_VERSION[kind]}`);
    db.exec(`PRAGMA application_id = ${APPLICATION_ID[kind]}`);
    db.exec('VACUUM');
    migrate(db, kind);
    return db;
  };
  return { data: split('data'), user: split('user') };
}

function rowsOf(db: Database, sql: string, params: SqlValue[] = []): Row[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: Row[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as Row);
    return rows;
  } finally {
    stmt.free();
  }
}

function snapshotFromRow(r: Row): PriceSnapshot {
  return {
    id: Number(r.id),
    uid: String(r.uid),
    itemId: Number(r.item_id),
    observedAt: Number(r.observed_at),
    ahType: r.ah_type === 'neutral' ? 'neutral' : 'faction',
    source: String(r.source) as SnapshotSource,
    totalQty: num(r.total_qty),
    levels: json<[number, number][]>(r.levels, []).map(([price, qty]): PriceLevel => ({ price, qty })),
    truncated: Number(r.truncated) === 1,
    owner: r.owner === null || r.owner === undefined ? null : String(r.owner),
    ...(r.origin !== null && r.origin !== undefined ? { origin: String(r.origin) } : {}),
  };
}

const KIND_NAME: Record<DbKind, string> = { data: 'game data', user: 'personal data', prices: 'AH prices' };

/**
 * Checks that a file holds what an import button expects (DEC-28). A legacy combined file holds game
 * and personal data, so either of those buttons takes it.
 */
/**
 * The bytes of a database for a file export. Game data leaves out the saved Wowhead tooltips: they
 * are only shown for checking a parse, and make up most of the file. `open` creates a database from
 * bytes (sql.js `new SQL.Database(bytes)`).
 */
export function exportBytes(db: Database, kind: DbKind, open: (bytes: Uint8Array) => Database): Uint8Array {
  if (kind !== 'data') return db.export();
  const copy = open(db.export());
  try {
    copy.exec('UPDATE items SET raw_tooltip = NULL; UPDATE recipes SET raw_tooltip = NULL; VACUUM;');
    return copy.export();
  } finally {
    copy.close();
  }
}

export function expectKind(found: DbKind | 'legacy' | 'empty', expected: DbKind): void {
  if (found === 'empty') throw new Error('The file is empty');
  if (found === expected || (found === 'legacy' && expected !== 'prices')) return;
  if (found === 'legacy') throw new Error('This is an old file with game data and personal data, not AH prices.');
  throw new Error(`This file holds ${KIND_NAME[found]}, not ${KIND_NAME[expected]}.`);
}

/**
 * Thin typed access to the databases. Call `onChange` after writes so the caller can persist
 * the database that changed.
 */
export class Repo {
  readonly data: Database;
  readonly user: Database;
  readonly prices: Database;

  constructor(
    dbs: Dbs,
    private onChange: (kind: DbKind) => void = () => {},
  ) {
    this.data = dbs.data;
    this.user = dbs.user;
    this.prices = dbs.prices;
  }

  private all(kind: DbKind, sql: string, params: SqlValue[] = []): Row[] {
    return rowsOf(this[kind], sql, params);
  }

  private run(kind: DbKind, sql: string, params: SqlValue[] = []): void {
    this[kind].run(sql, params);
    this.onChange(kind);
  }

  private lastId(kind: DbKind): number {
    return Number(this[kind].exec('SELECT last_insert_rowid()')[0].values[0][0]);
  }

  // Items -------------------------------------------------------------------

  listItems(): ItemRecord[] {
    return this.all('data', 'SELECT * FROM items ORDER BY id').map((r) => ({
      id: Number(r.id),
      imported: json(r.imported, {} as ItemRecord['imported']),
      overrides: json(r.overrides, {}),
      vendorBuy: num(r.vendor_buy),
      source: r.source as ItemRecord['source'],
      fetchedAt: num(r.fetched_at),
      updatedAt: Number(r.updated_at),
      rawTooltip: (r.raw_tooltip as string | null) ?? null,
    }));
  }

  saveItem(item: ItemRecord): void {
    this.run(
      'data',
      `INSERT INTO items (id, imported, overrides, vendor_buy, source, fetched_at, updated_at, raw_tooltip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET imported=excluded.imported, overrides=excluded.overrides,
         vendor_buy=excluded.vendor_buy, source=excluded.source, fetched_at=excluded.fetched_at,
         updated_at=excluded.updated_at, raw_tooltip=excluded.raw_tooltip`,
      [
        item.id,
        JSON.stringify(item.imported),
        JSON.stringify(item.overrides),
        item.vendorBuy,
        item.source,
        item.fetchedAt,
        item.updatedAt,
        item.rawTooltip,
      ],
    );
  }

  deleteItem(id: number): void {
    this.run('data', 'DELETE FROM items WHERE id = ?', [id]);
  }

  // Recipes -----------------------------------------------------------------

  listRecipes(): RecipeRecord[] {
    return this.all('data', 'SELECT * FROM recipes ORDER BY id').map((r) => {
      const imported = json(r.imported, {} as RecipeRecord['imported']);
      return {
        id: String(r.id),
        spellId: num(r.spell_id),
        imported: {
          ...imported,
          outputMode: imported.outputMode ?? 'independent',
          requiredSkill: imported.requiredSkill ?? null,
          learnedFrom: imported.learnedFrom ?? [],
          skillRange: imported.skillRange ?? null,
        },
        overrides: json(r.overrides, {}),
        source: r.source as RecipeRecord['source'],
        fetchedAt: num(r.fetched_at),
        updatedAt: Number(r.updated_at),
        rawTooltip: (r.raw_tooltip as string | null) ?? null,
      };
    });
  }

  saveRecipe(recipe: RecipeRecord): void {
    this.run(
      'data',
      `INSERT INTO recipes (id, spell_id, imported, overrides, source, fetched_at, updated_at, raw_tooltip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET spell_id=excluded.spell_id, imported=excluded.imported,
         overrides=excluded.overrides, source=excluded.source, fetched_at=excluded.fetched_at,
         updated_at=excluded.updated_at, raw_tooltip=excluded.raw_tooltip`,
      [
        recipe.id,
        recipe.spellId,
        JSON.stringify(recipe.imported),
        JSON.stringify(recipe.overrides),
        recipe.source,
        recipe.fetchedAt,
        recipe.updatedAt,
        recipe.rawTooltip,
      ],
    );
  }

  deleteRecipe(id: string): void {
    this.run('data', 'DELETE FROM recipes WHERE id = ?', [id]);
  }

  nextLocalRecipeId(): string {
    const rows = this.all('data', `SELECT id FROM recipes WHERE id LIKE 'local:%'`);
    const max = rows.reduce((m, r) => Math.max(m, Number(String(r.id).slice(6)) || 0), 0);
    return `local:${max + 1}`;
  }

  // Disenchant rules --------------------------------------------------------

  listDeRules(): DisenchantRule[] {
    return this.all('data', 'SELECT * FROM de_rules ORDER BY quality, item_class, ilvl_min').map((r) => ({
      id: Number(r.id),
      quality: Number(r.quality) as DisenchantRule['quality'],
      ilvlMin: Number(r.ilvl_min),
      ilvlMax: Number(r.ilvl_max),
      itemClass: r.item_class as DisenchantRule['itemClass'],
      outputs: json(r.outputs, []),
      notes: String(r.notes ?? ''),
    }));
  }

  /** Insert when id is 0, otherwise update. Returns the id. */
  saveDeRule(rule: DisenchantRule): number {
    const params: SqlValue[] = [
      rule.quality,
      rule.ilvlMin,
      rule.ilvlMax,
      rule.itemClass,
      JSON.stringify(rule.outputs),
      rule.notes,
    ];
    if (rule.id) {
      this.run(
        'data',
        'UPDATE de_rules SET quality=?, ilvl_min=?, ilvl_max=?, item_class=?, outputs=?, notes=? WHERE id=?',
        [...params, rule.id],
      );
      return rule.id;
    }
    this.run('data', 'INSERT INTO de_rules (quality, ilvl_min, ilvl_max, item_class, outputs, notes) VALUES (?,?,?,?,?,?)', params);
    return this.lastId('data');
  }

  deleteDeRule(id: number): void {
    this.run('data', 'DELETE FROM de_rules WHERE id = ?', [id]);
  }

  // Waylaid Crates ----------------------------------------------------------

  listFavorCrates(): FavorCrate[] {
    return this.all('data', 'SELECT * FROM favor_crates ORDER BY id').map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      itemId: num(r.item_id),
      favor: num(r.favor),
      bundles: json(r.bundles, []),
      notes: String(r.notes ?? ''),
    }));
  }

  /** Insert when id is 0, otherwise update. Returns the id. */
  saveFavorCrate(crate: FavorCrate): number {
    const params: SqlValue[] = [crate.name, crate.itemId, crate.favor, JSON.stringify(crate.bundles), crate.notes];
    if (crate.id) {
      this.run('data', 'UPDATE favor_crates SET name=?, item_id=?, favor=?, bundles=?, notes=? WHERE id=?', [...params, crate.id]);
      return crate.id;
    }
    this.run('data', 'INSERT INTO favor_crates (name, item_id, favor, bundles, notes) VALUES (?,?,?,?,?)', params);
    return this.lastId('data');
  }

  deleteFavorCrate(id: number): void {
    this.run('data', 'DELETE FROM favor_crates WHERE id = ?', [id]);
  }

  // Prices ------------------------------------------------------------------

  /** Min AH prices you set per item: the worst-case sell price (REQ-4.2). */
  listAhMins(): Map<number, Copper> {
    return new Map(this.all('user', 'SELECT item_id, price FROM ah_min_prices').map((r) => [Number(r.item_id), Number(r.price)]));
  }

  /** Set, or clear with null, an item's min AH price. */
  setAhMin(itemId: number, price: Copper | null): void {
    if (price === null) this.run('user', 'DELETE FROM ah_min_prices WHERE item_id = ?', [itemId]);
    else
      this.run(
        'user',
        `INSERT INTO ah_min_prices (item_id, price, updated_at) VALUES (?,?,?)
         ON CONFLICT(item_id) DO UPDATE SET price=excluded.price, updated_at=excluded.updated_at`,
        [itemId, price, Date.now()],
      );
  }

  /**
   * Moves AH prices from the old per-item price table of the personal database into price snapshots
   * (DEC-27), then drops that table. Each becomes a one-row manual snapshot on the faction AH. Safe to
   * run again: the uid skips snapshots already moved, and without the table there is nothing to do.
   * Returns how many prices were moved.
   */
  moveLegacyPrices(): number {
    const exists = this.all('user', `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'price_observations'`).length > 0;
    if (!exists) return 0;
    let moved = 0;
    for (const r of this.all('user', 'SELECT item_id, ah_price, observed_at FROM price_observations WHERE ah_price IS NOT NULL ORDER BY id')) {
      const itemId = Number(r.item_id);
      const price = Number(r.ah_price);
      const observedAt = Number(r.observed_at);
      const added = this.addSnapshot({
        uid: `legacy-${itemId}-${observedAt}-${price}`,
        itemId,
        observedAt,
        ahType: 'faction',
        source: 'manual',
        totalQty: null,
        levels: [{ price, qty: 1 }],
        truncated: true,
      });
      if (added) moved++;
    }
    this.user.exec('DROP TABLE price_observations');
    this.onChange('user');
    return moved;
  }

  // Price snapshots (prices database, DEC-23) -------------------------------

  /**
   * Stores a snapshot with its derived stats. A snapshot whose uid is already stored is skipped.
   * Returns whether it was added.
   */
  addSnapshot(snap: PriceSnapshot): boolean {
    const sum = summarize(snap);
    this.prices.run(
      `INSERT OR IGNORE INTO price_snapshots
        (uid, item_id, observed_at, ah_type, source, total_qty, levels, truncated, min_price, min_qty, market_value, confidence, owner, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        snap.uid,
        snap.itemId,
        snap.observedAt,
        snap.ahType,
        snap.source,
        snap.totalQty,
        JSON.stringify(snap.levels.map((l) => [l.price, l.qty])),
        snap.truncated ? 1 : 0,
        sum.minPrice,
        sum.minQty,
        sum.marketValue,
        sum.confidence,
        snap.owner === undefined ? this.playerId() : snap.owner,
        snap.origin ?? null,
      ],
    );
    const added = this.prices.getRowsModified() > 0;
    if (added) this.onChange('prices');
    return added;
  }

  /** Snapshots, oldest first. Optionally for one item and from a moment on. */
  listSnapshots(filter: { itemId?: number; since?: number } = {}): PriceSnapshot[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter.itemId !== undefined) {
      where.push('item_id = ?');
      params.push(filter.itemId);
    }
    if (filter.since !== undefined) {
      where.push('observed_at >= ?');
      params.push(filter.since);
    }
    const sql = `SELECT * FROM price_snapshots ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY observed_at, id`;
    return this.all('prices', sql, params).map(snapshotFromRow);
  }

  /**
   * Adds the snapshots of another prices file to yours (DEC-28): "Add pricing data". Snapshots you
   * already have (same uid) are skipped, so nothing of yours changes and the same file twice adds
   * nothing. Added snapshots are marked with `origin`: where the file got them, else the file's name.
   */
  addSnapshotsFrom(other: Database, origin: string): { added: number; skipped: number } {
    const theirs = rowsOf(other, 'SELECT * FROM price_snapshots ORDER BY observed_at, id').map(snapshotFromRow);
    const me = this.playerId();
    let added = 0;
    this.prices.exec('BEGIN');
    try {
      for (const { id: _, ...snap } of theirs) {
        // Your own snapshots (a backup) come back as yours; anyone else's are marked with where they came from.
        const mine = snap.owner === me;
        const row = mine ? { ...snap, origin: undefined } : { ...snap, owner: snap.owner ?? null, origin: snap.origin ?? origin };
        if (this.addSnapshot(row)) added++;
      }
      this.prices.exec('COMMIT');
    } catch (e) {
      this.prices.exec('ROLLBACK');
      throw e;
    }
    return { added, skipped: theirs.length - added };
  }

  /**
   * Your random player id, kept in personal data, so prices you recorded can be told apart from
   * other players' (DEC-28). Created on first use.
   */
  playerId(): string {
    if (this.player) return this.player;
    const row = this.all('user', `SELECT value FROM settings WHERE key = 'playerId'`)[0];
    if (row) return (this.player = String(row.value));
    this.player = crypto.randomUUID();
    this.run('user', `INSERT INTO settings (key, value) VALUES ('playerId', ?)`, [this.player]);
    return this.player;
  }
  private player: string | null = null;

  /** Marks snapshots with no owner and no origin as yours: those recorded before player ids. */
  claimUnownedSnapshots(): void {
    const n = Number(this.all('prices', 'SELECT COUNT(*) AS n FROM price_snapshots WHERE owner IS NULL AND origin IS NULL')[0].n);
    if (n) this.run('prices', 'UPDATE price_snapshots SET owner = ? WHERE owner IS NULL AND origin IS NULL', [this.playerId()]);
  }

  /** Removes every snapshot added from someone else's file; your own stay. Returns how many went. */
  removeAddedSnapshots(): number {
    const n = this.all('prices', 'SELECT COUNT(*) AS n FROM price_snapshots WHERE origin IS NOT NULL')[0].n;
    this.run('prices', 'DELETE FROM price_snapshots WHERE origin IS NOT NULL');
    return Number(n);
  }

  deleteSnapshot(id: number): void {
    this.run('prices', 'DELETE FROM price_snapshots WHERE id = ?', [id]);
  }

  // Flip ledger (user database, DEC-26) ---------------------------------------

  /** Stores a transaction. One whose uid is already stored is skipped; returns whether it was added. */
  addTransaction(tx: Transaction): boolean {
    this.user.run(
      `INSERT OR IGNORE INTO flip_transactions (uid, item_id, kind, qty, unit_price, fee, ah_type, occurred_at, source, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [tx.uid, tx.itemId, tx.kind, tx.qty, tx.unitPrice, tx.fee, tx.ahType, tx.occurredAt, tx.source, tx.note],
    );
    const added = this.user.getRowsModified() > 0;
    if (added) this.onChange('user');
    return added;
  }

  /** Transactions, oldest first. Optionally for one item. */
  listTransactions(itemId?: number): Transaction[] {
    const rows =
      itemId === undefined
        ? this.all('user', 'SELECT * FROM flip_transactions ORDER BY occurred_at, id')
        : this.all('user', 'SELECT * FROM flip_transactions WHERE item_id = ? ORDER BY occurred_at, id', [itemId]);
    return rows.map((r) => ({
      id: Number(r.id),
      uid: String(r.uid),
      itemId: Number(r.item_id),
      kind: String(r.kind) as TransactionKind,
      qty: Number(r.qty),
      unitPrice: num(r.unit_price),
      fee: Number(r.fee),
      ahType: r.ah_type === 'neutral' ? 'neutral' : 'faction',
      occurredAt: Number(r.occurred_at),
      source: String(r.source) as TransactionSource,
      note: String(r.note ?? ''),
    }));
  }

  deleteTransaction(id: number): void {
    this.run('user', 'DELETE FROM flip_transactions WHERE id = ?', [id]);
  }

  // Workflows ---------------------------------------------------------------

  listWorkflows(): Workflow[] {
    return this.all('user', 'SELECT * FROM workflows ORDER BY name').map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      notes: String(r.notes ?? ''),
      steps: json(r.steps, []),
      unitItemId: num(r.unit_item_id),
      buyMap: json(r.buy_map, {}),
      sellMap: json(r.sell_map, {}),
      batchSize: num(r.batch_size),
      ahType: r.ah_type as Workflow['ahType'],
      ahDuration: String(r.ah_duration),
      targetGoldPerHour: num(r.target_gph),
      updatedAt: Number(r.updated_at),
    }));
  }

  /** Insert when id is 0, otherwise update. Returns the id. */
  saveWorkflow(wf: Workflow): number {
    const params: SqlValue[] = [
      wf.name,
      wf.notes,
      JSON.stringify(wf.steps),
      wf.unitItemId,
      JSON.stringify(wf.buyMap),
      JSON.stringify(wf.sellMap),
      wf.batchSize,
      wf.ahType,
      wf.ahDuration,
      wf.targetGoldPerHour,
      wf.updatedAt,
    ];
    if (wf.id) {
      this.run(
        'user',
        `UPDATE workflows SET name=?, notes=?, steps=?, unit_item_id=?, buy_map=?, sell_map=?, batch_size=?,
         ah_type=?, ah_duration=?, target_gph=?, updated_at=? WHERE id=?`,
        [...params, wf.id],
      );
      return wf.id;
    }
    this.run(
      'user',
      `INSERT INTO workflows (name, notes, steps, unit_item_id, buy_map, sell_map, batch_size, ah_type, ah_duration, target_gph, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      params,
    );
    return this.lastId('user');
  }

  deleteWorkflow(id: number): void {
    this.run('user', 'DELETE FROM workflows WHERE id = ?', [id]);
  }

  // Onboarding --------------------------------------------------------------

  getOnboarding(): Onboarding {
    const row = this.all('user', `SELECT value FROM settings WHERE key = 'onboarding'`)[0];
    const stored = row ? json<Partial<Onboarding>>(row.value, {}) : {};
    return {
      tours: { ...NEW_ONBOARDING.tours, ...stored.tours },
      active: stored.active ?? null,
      read: stored.read ?? [],
      completed: stored.completed ?? false,
    };
  }

  saveOnboarding(onboarding: Onboarding): void {
    this.run('user', `INSERT INTO settings (key, value) VALUES ('onboarding', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [
      JSON.stringify(onboarding),
    ]);
  }

  // Characters (user database, #21) -------------------------------------------

  listCharacters(): Character[] {
    const learned = new Map<number, string[]>();
    for (const r of this.all('user', 'SELECT character_id, recipe_id FROM character_recipes ORDER BY recipe_id')) {
      const id = Number(r.character_id);
      learned.set(id, [...(learned.get(id) ?? []), String(r.recipe_id)]);
    }
    return this.all('user', 'SELECT * FROM characters ORDER BY name').map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      ruleset: (r.ruleset as Character['ruleset']) ?? null,
      faction: (r.faction as Character['faction']) ?? null,
      level: num(r.level),
      notes: String(r.notes ?? ''),
      professions: json(r.professions, []),
      learned: learned.get(Number(r.id)) ?? [],
      updatedAt: Number(r.updated_at),
    }));
  }

  /** Insert when id is 0, otherwise update. Returns the id. Learned recipes are set with setLearned. */
  saveCharacter(c: Character): number {
    const params: SqlValue[] = [c.name, c.ruleset, c.faction, c.level, c.notes, JSON.stringify(c.professions), c.updatedAt];
    if (c.id) {
      this.run('user', 'UPDATE characters SET name=?, ruleset=?, faction=?, level=?, notes=?, professions=?, updated_at=? WHERE id=?', [...params, c.id]);
      return c.id;
    }
    this.run('user', 'INSERT INTO characters (name, ruleset, faction, level, notes, professions, updated_at) VALUES (?,?,?,?,?,?,?)', params);
    return this.lastId('user');
  }

  deleteCharacter(id: number): void {
    this.run('user', 'DELETE FROM character_recipes WHERE character_id = ?', [id]);
    this.run('user', 'DELETE FROM characters WHERE id = ?', [id]);
  }

  /** Mark a recipe as learned by a character, or not. */
  setLearned(characterId: number, recipeId: string, learned: boolean): void {
    if (learned) {
      this.run('user', `INSERT OR IGNORE INTO character_recipes (character_id, recipe_id, source, learned_at) VALUES (?, ?, 'manual', ?)`, [
        characterId,
        recipeId,
        Date.now(),
      ]);
    } else {
      this.run('user', 'DELETE FROM character_recipes WHERE character_id = ? AND recipe_id = ?', [characterId, recipeId]);
    }
  }

  // Config ------------------------------------------------------------------

  getConfig(): Config {
    const row = this.all('user', `SELECT value FROM settings WHERE key = 'config'`)[0];
    return withDefaults(row ? json<Partial<Config>>(row.value, {}) : null);
  }

  saveConfig(config: Config): void {
    this.run('user', `INSERT INTO settings (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [
      JSON.stringify(config),
    ]);
  }

  // Flip favorites ----------------------------------------------------------

  listFlipFavorites(): FlipFavorite[] {
    const row = this.all('user', `SELECT value FROM settings WHERE key = 'flipFavorites'`)[0];
    return row ? json<FlipFavorite[]>(row.value, []) : [];
  }

  saveFlipFavorites(favorites: FlipFavorite[]): void {
    this.run('user', `INSERT INTO settings (key, value) VALUES ('flipFavorites', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [
      JSON.stringify(favorites),
    ]);
  }
}
