import type { Database } from 'sql.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { openBrowserDbs, openDbsFromBytes, openFreshDbs, persist, persister } from '../db/browser';
import { type DbKind, type Dbs, Repo } from '../db/repo';
import { effectiveItem, effectiveRecipe } from '../engine/items';
import type { Config, DisenchantRule, FlipFavorite, ItemRecord, PriceObservation, RecipeRecord, Workflow } from '../engine/types';
import type { EngineData } from '../engine/workflow';

export interface Snapshot {
  itemRecords: ItemRecord[];
  recipeRecords: RecipeRecord[];
  deRules: DisenchantRule[];
  prices: PriceObservation[];
  workflows: Workflow[];
  config: Config;
  flipFavorites: FlipFavorite[];
}

interface StoreValue extends Snapshot {
  repo: Repo;
  engine: EngineData;
  /** Run a write against the repo, then refresh the snapshot. */
  mutate: <T>(fn: (repo: Repo) => T) => T;
  /** Like mutate, for async work such as Wowhead imports. */
  mutateAsync: <T>(fn: (repo: Repo) => Promise<T>) => Promise<T>;
  exportDb: (kind: DbKind) => Uint8Array;
  /** Replaces the database(s) the file holds and returns which were replaced. */
  importDb: (bytes: Uint8Array) => Promise<DbKind[]>;
  /** Replaces the given databases with empty ones. */
  clearDb: (kinds: DbKind[]) => Promise<void>;
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
    flipFavorites: repo.listFlipFavorites(),
  };
}

const closeAll = (dbs: Dbs) => Object.values(dbs).forEach((db: Database) => db.close());

export function StoreProvider({ children }: { children: ReactNode }) {
  const dbsRef = useRef<Dbs | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savers = useMemo(
    () => ({ data: persister('data', () => dbsRef.current!.data), user: persister('user', () => dbsRef.current!.user) }),
    [],
  );

  const attach = useCallback(
    (dbs: Dbs) => {
      dbsRef.current = dbs;
      const r = new Repo(dbs.data, dbs.user, (kind) => savers[kind].schedule());
      setRepo(r);
      setSnap(readSnapshot(r));
    },
    [savers],
  );

  useEffect(() => {
    let cancelled = false;
    openBrowserDbs()
      .then((dbs) => (cancelled ? closeAll(dbs) : attach(dbs)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    const flush = () => {
      if (!dbsRef.current) return;
      void savers.data.flush();
      void savers.user.flush();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', flush);
    };
  }, [attach, savers]);

  const value = useMemo<StoreValue | null>(() => {
    if (!repo || !snap) return null;
    const refresh = () => setSnap(readSnapshot(repo));
    /** Swaps in the given databases and returns which were replaced. */
    const replace = async (dbs: Partial<Dbs>): Promise<DbKind[]> => {
      const kinds = (Object.keys(dbs) as DbKind[]).sort();
      const current = dbsRef.current!;
      // A pending debounced save reads dbsRef, so after the swap it saves the new database.
      for (const kind of kinds) await persist(kind, dbs[kind]!);
      for (const kind of kinds) current[kind].close();
      attach({ ...current, ...dbs });
      return kinds;
    };
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
      exportDb: (kind) => repo[kind].export(),
      importDb: async (bytes) => replace(await openDbsFromBytes(bytes)),
      clearDb: async (kinds) => void (await replace(await openFreshDbs(kinds))),
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
