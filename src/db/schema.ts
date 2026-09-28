/**
 * SQLite schema. Structured fields that are edited as a whole (recipe inputs/outputs, overrides,
 * workflow steps) are JSON text columns; everything that is looked up or filtered on is a column.
 * Append a migration to add changes; never edit an old one.
 *
 * Data is split over three database files so game data and prices can be shared without personal
 * data (DEC-21, DEC-23):
 * - data: items, recipes and disenchant rules. Shareable with other players.
 * - user: workflows, flip favorites, price observations and settings.
 * - prices: AH price snapshots. Shareable with other players on the same realm.
 * Each file has its own migrations and user_version, and is tagged with an application_id.
 */
import { deSeedMigration } from './deSeed';

export type DbKind = 'data' | 'user' | 'prices';

/** PRAGMA application_id per kind ('HTSD', 'HTSU', 'HTSP'). A file without one is a legacy combined file. */
export const APPLICATION_ID: Record<DbKind, number> = { data: 0x48545344, user: 0x48545355, prices: 0x48545350 };

export const DATA_MIGRATIONS: string[] = [
  `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    imported TEXT NOT NULL,
    overrides TEXT NOT NULL DEFAULT '{}',
    vendor_buy INTEGER,
    source TEXT NOT NULL,
    fetched_at INTEGER,
    updated_at INTEGER NOT NULL,
    raw_tooltip TEXT
  );
  CREATE TABLE recipes (
    id TEXT PRIMARY KEY,
    spell_id INTEGER,
    imported TEXT NOT NULL,
    overrides TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL,
    fetched_at INTEGER,
    updated_at INTEGER NOT NULL,
    raw_tooltip TEXT
  );
  CREATE TABLE de_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quality INTEGER NOT NULL,
    ilvl_min INTEGER NOT NULL,
    ilvl_max INTEGER NOT NULL,
    item_class TEXT NOT NULL,
    outputs TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
  );
  `,
  deSeedMigration(),
];

export const USER_MIGRATIONS: string[] = [
  `
  CREATE TABLE price_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    ah_price INTEGER,
    ah_pessimistic INTEGER,
    observed_at INTEGER NOT NULL
  );
  CREATE INDEX price_obs_item ON price_observations (item_id, observed_at);
  CREATE TABLE workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    steps TEXT NOT NULL,
    unit_item_id INTEGER,
    buy_map TEXT NOT NULL DEFAULT '{}',
    sell_map TEXT NOT NULL DEFAULT '{}',
    batch_size INTEGER,
    ah_type TEXT NOT NULL DEFAULT 'faction',
    ah_duration TEXT NOT NULL DEFAULT '8h',
    target_gph INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Pessimistic price renamed to min AH price. Old values are dropped, not carried over.
  `ALTER TABLE price_observations DROP COLUMN ah_pessimistic;
  ALTER TABLE price_observations ADD COLUMN ah_min INTEGER;`,
];

/**
 * AH price snapshots (DEC-23): the cheap end of the order book for one item at one moment, as rows
 * of (price, qty). The derived columns are computed from `levels` on save and can be recomputed.
 * `uid` is a stable id, so the same snapshot imported twice (a re-imported scan, a shared file)
 * is stored once.
 */
export const PRICES_MIGRATIONS: string[] = [
  `
  CREATE TABLE price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    ah_type TEXT NOT NULL DEFAULT 'faction',
    source TEXT NOT NULL,
    total_qty INTEGER,
    levels TEXT NOT NULL,
    truncated INTEGER NOT NULL,
    min_price INTEGER,
    min_qty INTEGER,
    market_value INTEGER,
    confidence TEXT
  );
  CREATE INDEX price_snap_item ON price_snapshots (item_id, observed_at);
  `,
];

/** The kinds a legacy combined file is split into. Prices did not exist yet. */
export type LegacyKind = 'data' | 'user';
export const LEGACY_KINDS: LegacyKind[] = ['data', 'user'];

/** Schema version of each kind at the split, which is what a split legacy file matches. */
export const SPLIT_VERSION: Record<LegacyKind, number> = { data: 2, user: 1 };

/** Tables of each legacy kind, used to split a legacy combined file. */
export const TABLES: Record<LegacyKind, string[]> = {
  data: ['items', 'recipes', 'de_rules'],
  user: ['price_observations', 'workflows', 'settings'],
};

/**
 * Frozen migrations of the old single-file database. Only used to bring a legacy file up to date
 * before it is split; its final schema equals the latest DATA_MIGRATIONS plus USER_MIGRATIONS
 * listed above as of the split. Add new changes to those lists, not here.
 */
export const LEGACY_MIGRATIONS: string[] = [
  `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    imported TEXT NOT NULL,
    overrides TEXT NOT NULL DEFAULT '{}',
    vendor_buy INTEGER,
    source TEXT NOT NULL,
    fetched_at INTEGER,
    updated_at INTEGER NOT NULL,
    raw_tooltip TEXT
  );
  CREATE TABLE recipes (
    id TEXT PRIMARY KEY,
    spell_id INTEGER,
    imported TEXT NOT NULL,
    overrides TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL,
    fetched_at INTEGER,
    updated_at INTEGER NOT NULL,
    raw_tooltip TEXT
  );
  CREATE TABLE de_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quality INTEGER NOT NULL,
    ilvl_min INTEGER NOT NULL,
    ilvl_max INTEGER NOT NULL,
    item_class TEXT NOT NULL,
    outputs TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE price_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    ah_price INTEGER,
    ah_pessimistic INTEGER,
    observed_at INTEGER NOT NULL
  );
  CREATE INDEX price_obs_item ON price_observations (item_id, observed_at);
  CREATE TABLE workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    steps TEXT NOT NULL,
    unit_item_id INTEGER,
    buy_map TEXT NOT NULL DEFAULT '{}',
    sell_map TEXT NOT NULL DEFAULT '{}',
    batch_size INTEGER,
    ah_type TEXT NOT NULL DEFAULT 'faction',
    ah_duration TEXT NOT NULL DEFAULT '8h',
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  -- Starter disenchant rules from Classic knowledge (DEC-7). Verify against DE Tracker totals.
  -- 10940 Strange Dust, 10938 Lesser Magic Essence.
  INSERT INTO de_rules (quality, ilvl_min, ilvl_max, item_class, outputs, notes) VALUES
    (2, 5, 15, 'armor', '[{"itemId":10940,"chance":0.8,"minQty":1,"maxQty":2},{"itemId":10938,"chance":0.2,"minQty":1,"maxQty":2}]', 'Classic values, unverified for Forever'),
    (2, 5, 15, 'weapon', '[{"itemId":10940,"chance":0.2,"minQty":1,"maxQty":2},{"itemId":10938,"chance":0.8,"minQty":1,"maxQty":2}]', 'Classic values, unverified for Forever');
  `,
  deSeedMigration(),
  // Target gold per hour for solving the buy limit of a 'disenchant-any' step (DEC-20).
  `ALTER TABLE workflows ADD COLUMN target_gph INTEGER;`,
];
