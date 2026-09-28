import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { get, set } from 'idb-keyval';
import { migrate } from './repo';

/**
 * Browser SQLite: sql.js (SQLite compiled to WASM) in memory, with the database file persisted to
 * IndexedDB after every change. Works offline once loaded (NFR-6). Data lives in this browser only,
 * so use Settings > Export for backups.
 */
const KEY = 'harmless-tradeskills.sqlite';

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;
const sql = () => (sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl }));

export async function openBrowserDb(): Promise<Database> {
  const SQL = await sql();
  const bytes = await get<Uint8Array>(KEY);
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  migrate(db);
  await persist(db);
  return db;
}

export async function openDbFromBytes(bytes: Uint8Array): Promise<Database> {
  const SQL = await sql();
  const db = new SQL.Database(bytes);
  migrate(db);
  return db;
}

export async function persist(db: Database): Promise<void> {
  await set(KEY, db.export());
}

/** Debounced persist, so a burst of writes costs one IndexedDB save. */
export function persister(db: () => Database, delayMs = 250): { schedule: () => void; flush: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    await persist(db());
  };
  return {
    schedule: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
  };
}
