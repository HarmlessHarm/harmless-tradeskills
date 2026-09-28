/**
 * SQLite schema. Structured fields that are edited as a whole (recipe inputs/outputs, overrides,
 * workflow steps) are JSON text columns; everything that is looked up or filtered on is a column.
 * Append a migration to add changes; never edit an old one.
 *
 * Data is split over two database files so game data can be shared without personal data
 * (DEC-21):
 * - data: items, recipes and disenchant rules. Shareable with other players.
 * - user: workflows, flip favorites, price observations and settings.
 * Each file has its own migrations and user_version, and is tagged with an application_id.
 */
import { deSeedMigration } from './deSeed';

export type DbKind = 'data' | 'user';

/** PRAGMA application_id per kind ('HTSD' and 'HTSU'). A file without one is a legacy combined file. */
export const APPLICATION_ID: Record<DbKind, number> = { data: 0x48545344, user: 0x48545355 };

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
];

/** Schema version of each kind at the split, which is what a split legacy file matches. */
export const SPLIT_VERSION: Record<DbKind, number> = { data: 2, user: 1 };

/** Tables of each kind, used to split a legacy combined file. */
export const TABLES: Record<DbKind, string[]> = {
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
