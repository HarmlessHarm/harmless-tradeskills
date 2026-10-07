import type { Repo } from '../db/repo';
import { isCrateName, matchBundles, tierFavor } from '../engine/favor';
import { effectiveItem } from '../engine/items';
import type { FavorCrate, ItemRecord } from '../engine/types';
import { parseCrateBundles, type CrateLine, type Fetcher } from '../wowhead/adapter';
import { importItem } from './importer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BULK_DELAY_MS = 400;

export interface CrateSync {
  name: string;
  /** No crate had this name yet, so one was added. */
  created: boolean;
  /** Bundles read from the tooltip and found in your items. */
  matched: number;
  /** Bundle lines whose item is not in your items yet. */
  unmatched: CrateLine[];
  /** The tooltip had no bundle list, so the crate's bundles were kept. */
  noList: boolean;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Link a crate item to its crate (found by name, or added) and set the crate's bundles from the
 * item's tooltip. The tooltip lists items by name, so they are matched to your items by name.
 * When the tooltip has a bundle list it replaces the crate's bundles; otherwise they are kept.
 * Favor is only filled in when it is empty.
 */
export function syncCrate(repo: Repo, record: ItemRecord): CrateSync {
  const name = effectiveItem(record).name;
  const lines = record.rawTooltip ? parseCrateBundles(record.rawTooltip) : [];
  const { bundles, unmatched } = matchBundles(lines, repo.listItems().map(effectiveItem));
  const crates = repo.listFavorCrates();
  const existing = crates.find((c) => c.itemId === record.id) ?? crates.find((c) => sameName(c.name, name));
  const crate: FavorCrate = existing ?? { id: 0, name, itemId: null, favor: null, bundles: [], notes: '' };
  repo.saveFavorCrate({
    ...crate,
    name,
    itemId: record.id,
    favor: crate.favor ?? tierFavor(name),
    bundles: lines.length ? bundles : crate.bundles,
  });
  return { name, created: !existing, matched: bundles.length, unmatched, noList: lines.length === 0 };
}

/** Crate items already in your items, linked to their crates (no Wowhead requests). */
export function syncCratesFromCatalog(repo: Repo): CrateSync[] {
  return repo
    .listItems()
    .filter((r) => isCrateName(effectiveItem(r).name))
    .map((r) => syncCrate(repo, r));
}

export interface CrateImportResult {
  crates: CrateSync[];
  /** Pasted items that are not Waylaid Crates. */
  ignored: string[];
  errors: string[];
}

/**
 * Import pasted crate items from Wowhead and sync each crate. Items you have without a saved
 * tooltip are fetched again, since the tooltip holds the bundles.
 */
export async function importCrates(
  repo: Repo,
  ids: number[],
  onProgress: (done: number, total: number) => void,
  fetcher?: Fetcher,
): Promise<CrateImportResult> {
  const result: CrateImportResult = { crates: [], ignored: [], errors: [] };
  const unique = [...new Set(ids)];
  let fetched = false;
  onProgress(0, unique.length);
  for (const [i, id] of unique.entries()) {
    try {
      const have = repo.listItems().find((r) => r.id === id);
      const needsFetch = !have?.rawTooltip;
      if (needsFetch && fetched) await sleep(BULK_DELAY_MS);
      fetched ||= needsFetch;
      const record = await importItem(repo, id, { force: needsFetch, fetcher });
      const name = effectiveItem(record).name;
      if (isCrateName(name)) result.crates.push(syncCrate(repo, record));
      else result.ignored.push(name);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
    onProgress(i + 1, unique.length);
  }
  return result;
}
