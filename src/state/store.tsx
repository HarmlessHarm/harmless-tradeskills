import type { Database } from 'sql.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { openBrowserDb, openDbFromBytes, persist, persister } from '../db/browser';
import { Repo } from '../db/repo';
import { effectiveItem, effectiveRecipe } from '../engine/items';
import type { Config, DisenchantRule, ItemRecord, PriceObservation, RecipeRecord, Workflow } from '../engine/types';
import type { EngineData } from '../engine/workflow';

export interface Snapshot {
  itemRecords: ItemRecord[];
  recipeRecords: RecipeRecord[];
  deRules: DisenchantRule[];
  prices: PriceObservation[];
  workflows: Workflow[];
  config: Config;
}

interface StoreValue extends Snapshot {
  repo: Repo;
  engine: EngineData;
  /** Run a write against the repo, then refresh the snapshot. */
  mutate: <T>(fn: (repo: Repo) => T) => T;
  /** Like mutate, for async work such as Wowhead imports. */
  mutateAsync: <T>(fn: (repo: Repo) => Promise<T>) => Promise<T>;
  exportDb: () => Uint8Array;
  importDb: (bytes: Uint8Array) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

function readSnapshot(repo: Repo): Snapshot {
  return {
    itemRecords: repo.listItems(),
    recipeRecords: repo.listRecipes(),
    deRules: repo.listDeRules(),
    prices: repo.latestPrices(),
    workflows: repo.listWorkflows(),
    config: repo.getConfig(),
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const dbRef = useRef<Database | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saver = useMemo(() => persister(() => dbRef.current!), []);

  const attach = useCallback(
    (db: Database) => {
      dbRef.current = db;
      const r = new Repo(db, saver.schedule);
      setRepo(r);
      setSnap(readSnapshot(r));
    },
    [saver],
  );

  useEffect(() => {
    let cancelled = false;
    openBrowserDb()
      .then((db) => (cancelled ? db.close() : attach(db)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    const flush = () => dbRef.current && void saver.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', flush);
    };
  }, [attach, saver]);

  const value = useMemo<StoreValue | null>(() => {
    if (!repo || !snap) return null;
    const refresh = () => setSnap(readSnapshot(repo));
    const engine: EngineData = {
      items: new Map(snap.itemRecords.map((r) => [r.id, effectiveItem(r)])),
      recipes: new Map(snap.recipeRecords.map((r) => [r.id, effectiveRecipe(r)])),
      prices: new Map(snap.prices.map((p) => [p.itemId, p])),
      deRules: snap.deRules,
      config: snap.config,
    };
    return {
      ...snap,
      repo,
      engine,
      mutate: (fn) => {
        try {
          return fn(repo);
        } finally {
          refresh();
        }
      },
      mutateAsync: async (fn) => {
        try {
          return await fn(repo);
        } finally {
          refresh();
        }
      },
      exportDb: () => repo.db.export(),
      importDb: async (bytes) => {
        const db = await openDbFromBytes(bytes);
        await persist(db);
        dbRef.current?.close();
        attach(db);
      },
    };
  }, [repo, snap, attach]);

  if (error) return <div className="boot boot-error">Could not open the database: {error}</div>;
  if (!value) return <div className="boot">Loading database...</div>;
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
