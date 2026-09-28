import type { Database, SqlValue } from 'sql.js';
import { withDefaults } from '../config';
import type {
  Config,
  DisenchantRule,
  FlipFavorite,
  ItemRecord,
  PriceObservation,
  RecipeRecord,
  Workflow,
} from '../engine/types';
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
    const stmt = this[kind].prepare(sql);
    try {
      stmt.bind(params);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Row);
      return rows;
    } finally {
      stmt.free();
    }
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
        imported: { ...imported, outputMode: imported.outputMode ?? 'independent' },
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

  // Prices ------------------------------------------------------------------

  /** Latest observation per item. */
  latestPrices(): PriceObservation[] {
    return this.all(
      'user',
      `SELECT p.* FROM price_observations p
       JOIN (SELECT item_id, MAX(id) AS id FROM price_observations GROUP BY item_id) latest ON latest.id = p.id`,
    ).map((r) => ({
      itemId: Number(r.item_id),
      ahPrice: num(r.ah_price),
      ahMin: num(r.ah_min),
      observedAt: Number(r.observed_at),
    }));
  }

  addPrice(obs: PriceObservation): void {
    this.run('user', 'INSERT INTO price_observations (item_id, ah_price, ah_min, observed_at) VALUES (?,?,?,?)', [
      obs.itemId,
      obs.ahPrice,
      obs.ahMin,
      obs.observedAt,
    ]);
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
        (uid, item_id, observed_at, ah_type, source, total_qty, levels, truncated, min_price, min_qty, market_value, confidence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    return this.all('prices', sql, params).map((r) => ({
      id: Number(r.id),
      uid: String(r.uid),
      itemId: Number(r.item_id),
      observedAt: Number(r.observed_at),
      ahType: r.ah_type === 'neutral' ? 'neutral' : 'faction',
      source: String(r.source) as SnapshotSource,
      totalQty: num(r.total_qty),
      levels: json<[number, number][]>(r.levels, []).map(([price, qty]): PriceLevel => ({ price, qty })),
      truncated: Number(r.truncated) === 1,
    }));
  }

  deleteSnapshot(id: number): void {
    this.run('prices', 'DELETE FROM price_snapshots WHERE id = ?', [id]);
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
