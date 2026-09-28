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
import { MIGRATIONS } from './schema';

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

export function migrate(db: Database): void {
  const current = Number(db.exec('PRAGMA user_version')[0]?.values[0][0] ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** Thin typed access to the database. Call `onChange` after writes so the caller can persist. */
export class Repo {
  constructor(
    readonly db: Database,
    private onChange: () => void = () => {},
  ) {}

  private all(sql: string, params: SqlValue[] = []): Row[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Row);
      return rows;
    } finally {
      stmt.free();
    }
  }

  private run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params);
    this.onChange();
  }

  // Items -------------------------------------------------------------------

  listItems(): ItemRecord[] {
    return this.all('SELECT * FROM items ORDER BY id').map((r) => ({
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
    this.run('DELETE FROM items WHERE id = ?', [id]);
  }

  // Recipes -----------------------------------------------------------------

  listRecipes(): RecipeRecord[] {
    return this.all('SELECT * FROM recipes ORDER BY id').map((r) => {
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
    this.run('DELETE FROM recipes WHERE id = ?', [id]);
  }

  nextLocalRecipeId(): string {
    const rows = this.all(`SELECT id FROM recipes WHERE id LIKE 'local:%'`);
    const max = rows.reduce((m, r) => Math.max(m, Number(String(r.id).slice(6)) || 0), 0);
    return `local:${max + 1}`;
  }

  // Disenchant rules --------------------------------------------------------

  listDeRules(): DisenchantRule[] {
    return this.all('SELECT * FROM de_rules ORDER BY quality, item_class, ilvl_min').map((r) => ({
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
        'UPDATE de_rules SET quality=?, ilvl_min=?, ilvl_max=?, item_class=?, outputs=?, notes=? WHERE id=?',
        [...params, rule.id],
      );
      return rule.id;
    }
    this.run('INSERT INTO de_rules (quality, ilvl_min, ilvl_max, item_class, outputs, notes) VALUES (?,?,?,?,?,?)', params);
    return Number(this.db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  }

  deleteDeRule(id: number): void {
    this.run('DELETE FROM de_rules WHERE id = ?', [id]);
  }

  // Prices ------------------------------------------------------------------

  /** Latest observation per item. */
  latestPrices(): PriceObservation[] {
    return this.all(
      `SELECT p.* FROM price_observations p
       JOIN (SELECT item_id, MAX(id) AS id FROM price_observations GROUP BY item_id) latest ON latest.id = p.id`,
    ).map((r) => ({
      itemId: Number(r.item_id),
      ahPrice: num(r.ah_price),
      ahPessimistic: num(r.ah_pessimistic),
      observedAt: Number(r.observed_at),
    }));
  }

  addPrice(obs: PriceObservation): void {
    this.run('INSERT INTO price_observations (item_id, ah_price, ah_pessimistic, observed_at) VALUES (?,?,?,?)', [
      obs.itemId,
      obs.ahPrice,
      obs.ahPessimistic,
      obs.observedAt,
    ]);
  }

  // Workflows ---------------------------------------------------------------

  listWorkflows(): Workflow[] {
    return this.all('SELECT * FROM workflows ORDER BY name').map((r) => ({
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
      wf.updatedAt,
    ];
    if (wf.id) {
      this.run(
        `UPDATE workflows SET name=?, notes=?, steps=?, unit_item_id=?, buy_map=?, sell_map=?, batch_size=?,
         ah_type=?, ah_duration=?, updated_at=? WHERE id=?`,
        [...params, wf.id],
      );
      return wf.id;
    }
    this.run(
      `INSERT INTO workflows (name, notes, steps, unit_item_id, buy_map, sell_map, batch_size, ah_type, ah_duration, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      params,
    );
    return Number(this.db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  }

  deleteWorkflow(id: number): void {
    this.run('DELETE FROM workflows WHERE id = ?', [id]);
  }

  // Config ------------------------------------------------------------------

  getConfig(): Config {
    const row = this.all(`SELECT value FROM settings WHERE key = 'config'`)[0];
    return withDefaults(row ? json<Partial<Config>>(row.value, {}) : null);
  }

  saveConfig(config: Config): void {
    this.run(`INSERT INTO settings (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [
      JSON.stringify(config),
    ]);
  }

  // Flip favorites ----------------------------------------------------------

  listFlipFavorites(): FlipFavorite[] {
    const row = this.all(`SELECT value FROM settings WHERE key = 'flipFavorites'`)[0];
    return row ? json<FlipFavorite[]>(row.value, []) : [];
  }

  saveFlipFavorites(favorites: FlipFavorite[]): void {
    this.run(`INSERT INTO settings (key, value) VALUES ('flipFavorites', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [
      JSON.stringify(favorites),
    ]);
  }
}
