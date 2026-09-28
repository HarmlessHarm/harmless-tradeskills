import initSqlJs from 'sql.js';
import { type DbKind, migrate, Repo } from '../db/repo';

/** A repo over fresh in-memory data, user and prices databases, prepared as the app does on load. */
export async function freshRepo(onChange?: (kind: DbKind) => void): Promise<Repo> {
  const SQL = await initSqlJs();
  const fresh = (kind: DbKind) => {
    const db = new SQL.Database();
    migrate(db, kind);
    return db;
  };
  const dbs = { data: fresh('data'), user: fresh('user'), prices: fresh('prices') };
  new Repo(dbs).moveLegacyPrices();
  return new Repo(dbs, onChange);
}
