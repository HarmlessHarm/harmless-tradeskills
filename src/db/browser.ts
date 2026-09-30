import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { del, get, set } from 'idb-keyval';
import { dbKind, type DbKind, type Dbs, expectKind, migrate, splitLegacy } from './repo';

/**
 * Browser SQLite: sql.js (SQLite compiled to WASM) in memory, with the database files persisted to
 * IndexedDB after every change. Works offline once loaded (NFR-6). Data lives in this browser only,
 * so use Settings > Export for backups. Game data, personal data and prices are separate files
 * (DEC-21, DEC-23).
 */
const KEYS: Record<DbKind, string> = {
  data: 'harmless-tradeskills.data.sqlite',
  user: 'harmless-tradeskills.user.sqlite',
  prices: 'harmless-tradeskills.prices.sqlite',
};
/** The single combined file used before the split. Split into both on first load. */
const LEGACY_KEY = 'harmless-tradeskills.sqlite';

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;
const sql = () => (sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl }));

export async function openBrowserDbs(): Promise<Dbs> {
  const SQL = await sql();
  const [data, user, prices, legacy] = await Promise.all([
    get<Uint8Array>(KEYS.data),
    get<Uint8Array>(KEYS.user),
    get<Uint8Array>(KEYS.prices),
    get<Uint8Array>(LEGACY_KEY),
  ]);
  const open = async (kind: DbKind, bytes: Uint8Array | undefined) => {
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    migrate(db, kind);
    await persist(kind, db);
    return db;
  };
  if (!data && !user && legacy) {
    const legacyDb = new SQL.Database(legacy);
    const dbs = splitLegacy(legacyDb, (b) => new SQL.Database(b));
    legacyDb.close();
    await Promise.all([persist('data', dbs.data), persist('user', dbs.user)]);
    await del(LEGACY_KEY);
    return { ...dbs, prices: await open('prices', prices) };
  }
  return { data: await open('data', data), user: await open('user', user), prices: await open('prices', prices) };
}

/**
 * Opens a file to replace one kind of data with (game data or personal data, DEC-28). Throws if the
 * file holds another kind. Returns the databases it replaces: the expected one, or data and user for
 * a legacy combined file.
 */
export async function openDbsFromBytes(bytes: Uint8Array, expected: 'data' | 'user'): Promise<Partial<Dbs>> {
  const SQL = await sql();
  const db = new SQL.Database(bytes);
  try {
    const kind = dbKind(db);
    expectKind(kind, expected);
    if (kind === 'legacy') {
      const dbs = splitLegacy(db, (b) => new SQL.Database(b));
      db.close();
      return dbs;
    }
    migrate(db, expected);
    return { [expected]: db };
  } catch (e) {
    db.close();
    throw e;
  }
}

/** Throws unless the file holds the expected kind, so a wrong file is refused before anything is asked. */
export async function checkFileKind(bytes: Uint8Array, expected: DbKind): Promise<void> {
  const SQL = await sql();
  const db = new SQL.Database(bytes);
  try {
    expectKind(dbKind(db), expected);
  } finally {
    db.close();
  }
}

/** Opens a prices file to add from ("Add pricing data"). The caller closes it. */
export async function openPricesFile(bytes: Uint8Array): Promise<Database> {
  const SQL = await sql();
  const db = new SQL.Database(bytes);
  try {
    expectKind(dbKind(db), 'prices');
    migrate(db, 'prices');
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

/** New empty databases of the given kinds, as on first use (disenchant rules are seeded again). */
export async function openFreshDbs(kinds: DbKind[]): Promise<Partial<Dbs>> {
  const SQL = await sql();
  const dbs: Partial<Dbs> = {};
  for (const kind of kinds) {
    const db = new SQL.Database();
    migrate(db, kind);
    dbs[kind] = db;
  }
  return dbs;
}

export async function persist(kind: DbKind, db: Database): Promise<void> {
  await set(KEYS[kind], db.export());
}

/** Debounced persist, so a burst of writes costs one IndexedDB save. */
export function persister(kind: DbKind, db: () => Database, delayMs = 250): { schedule: () => void; flush: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    await persist(kind, db());
  };
  return {
    schedule: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
  };
}
