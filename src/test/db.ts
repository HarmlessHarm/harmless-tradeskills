import initSqlJs from 'sql.js';
import { type DbKind, migrate, Repo } from '../db/repo';

/** A repo over fresh in-memory data and user databases. */
export async function freshRepo(onChange?: (kind: DbKind) => void): Promise<Repo> {
  const SQL = await initSqlJs();
  const data = new SQL.Database();
  const user = new SQL.Database();
  migrate(data, 'data');
  migrate(user, 'user');
  return new Repo(data, user, onChange);
}
