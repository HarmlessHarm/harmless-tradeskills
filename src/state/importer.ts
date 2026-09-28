import type { Repo } from '../db/repo';
import type { ItemRecord, RecipeRecord } from '../engine/types';
import { fetchTooltip, parseItemTooltip, parseSpellTooltip, type Fetcher, type WowheadRef } from '../wowhead/adapter';

/**
 * Lazy, on-demand imports (DEC-5, NFR-4). Existing overrides and manual fields are always kept.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pause between requests in bulk operations, to stay polite. */
const BULK_DELAY_MS = 400;

export async function importItem(repo: Repo, id: number, opts: { force?: boolean; fetcher?: Fetcher } = {}): Promise<ItemRecord> {
  const existing = repo.listItems().find((i) => i.id === id);
  if (existing && !opts.force) return existing;
  const data = await fetchTooltip({ type: 'item', id }, opts.fetcher);
  const now = Date.now();
  const record: ItemRecord = {
    id,
    imported: parseItemTooltip(data),
    overrides: existing?.overrides ?? {},
    vendorBuy: existing?.vendorBuy ?? null,
    source: 'wowhead',
    fetchedAt: now,
    updatedAt: now,
    rawTooltip: data.tooltip,
  };
  repo.saveItem(record);
  return record;
}

export interface RecipeImportResult {
  recipe: RecipeRecord;
  warnings: string[];
  itemErrors: string[];
}

export async function importRecipe(
  repo: Repo,
  spellId: number,
  opts: { force?: boolean; fetcher?: Fetcher } = {},
): Promise<RecipeImportResult> {
  const id = `spell:${spellId}`;
  const existing = repo.listRecipes().find((r) => r.id === id);
  if (existing && !opts.force) return { recipe: existing, warnings: [], itemErrors: [] };
  const data = await fetchTooltip({ type: 'spell', id: spellId }, opts.fetcher);
  const parsed = parseSpellTooltip(data);
  const now = Date.now();
  const recipe: RecipeRecord = {
    id,
    spellId,
    // Wowhead's tooltip has no profession, so keep one set earlier (by bulk import or by hand).
    imported: { ...parsed.fields, profession: parsed.fields.profession ?? existing?.imported.profession ?? null },
    overrides: existing?.overrides ?? {},
    source: 'wowhead',
    fetchedAt: now,
    updatedAt: now,
    rawTooltip: data.tooltip,
  };
  repo.saveRecipe(recipe);
  const itemErrors = await importMissingItems(repo, parsed.referencedItems, opts.fetcher);
  return { recipe, warnings: parsed.warnings, itemErrors };
}

/** Import items that are referenced but not in the catalog yet (REQ-2.1). Returns error messages. */
export async function importMissingItems(repo: Repo, ids: number[], fetcher?: Fetcher): Promise<string[]> {
  const known = new Set(repo.listItems().map((i) => i.id));
  const errors: string[] = [];
  let first = true;
  for (const id of new Set(ids)) {
    if (known.has(id)) continue;
    if (!first) await sleep(BULK_DELAY_MS);
    first = false;
    try {
      await importItem(repo, id, { fetcher });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return errors;
}

export interface BulkResult {
  imported: number;
  skipped: number;
  /** Recipes whose profession was set by this run. */
  tagged: number;
  errors: string[];
  warnings: string[];
}

/**
 * Import a pasted list of items and spells one request at a time. Spells go first, because a
 * recipe import also pulls in its reagents and created item, which then need no separate request.
 */
/** Set the profession on an imported recipe, as a base value so it is not shown as an edit. */
export function setRecipeProfession(repo: Repo, spellId: number, profession: string): boolean {
  const r = repo.listRecipes().find((x) => x.spellId === spellId);
  if (!r || r.imported.profession === profession) return false;
  repo.saveRecipe({ ...r, imported: { ...r.imported, profession }, updatedAt: Date.now() });
  return true;
}

export async function bulkImport(
  repo: Repo,
  refs: WowheadRef[],
  opts: { force: boolean; profession?: string | null },
  onProgress: (done: number, total: number) => void,
): Promise<BulkResult> {
  const ordered = [...refs.filter((r) => r.type === 'spell'), ...refs.filter((r) => r.type === 'item')];
  const result: BulkResult = { imported: 0, skipped: 0, tagged: 0, errors: [], warnings: [] };
  onProgress(0, ordered.length);
  for (let i = 0; i < ordered.length; i++) {
    const ref = ordered[i];
    const exists =
      ref.type === 'spell' ? repo.listRecipes().some((r) => r.spellId === ref.id) : repo.listItems().some((it) => it.id === ref.id);
    if (exists && !opts.force) {
      result.skipped++;
    } else {
      if (i > 0) await sleep(BULK_DELAY_MS);
      try {
        if (ref.type === 'spell') {
          const r = await importRecipe(repo, ref.id, { force: opts.force });
          result.warnings.push(...r.warnings.map((w) => `${r.recipe.imported.name}: ${w}`));
          result.errors.push(...r.itemErrors);
        } else {
          await importItem(repo, ref.id, { force: opts.force });
        }
        result.imported++;
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    // Tag pasted recipes with the chosen profession, including ones that were already imported.
    if (ref.type === 'spell' && opts.profession && setRecipeProfession(repo, ref.id, opts.profession)) result.tagged++;
    onProgress(i + 1, ordered.length);
  }
  return result;
}

/** Manual bulk refresh of Wowhead records older than maxAgeMs (REQ-1.3). */
export async function refreshStale(
  repo: Repo,
  maxAgeMs: number,
  onProgress: (done: number, total: number) => void,
): Promise<string[]> {
  const cutoff = Date.now() - maxAgeMs;
  const items = repo.listItems().filter((i) => i.source === 'wowhead' && (i.fetchedAt ?? 0) < cutoff);
  const recipes = repo.listRecipes().filter((r) => r.spellId !== null && r.source === 'wowhead' && (r.fetchedAt ?? 0) < cutoff);
  const total = items.length + recipes.length;
  const errors: string[] = [];
  let done = 0;
  onProgress(done, total);
  for (const i of items) {
    try {
      await importItem(repo, i.id, { force: true });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    onProgress(++done, total);
    await sleep(BULK_DELAY_MS);
  }
  for (const r of recipes) {
    try {
      const res = await importRecipe(repo, r.spellId!, { force: true });
      errors.push(...res.itemErrors);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    onProgress(++done, total);
    await sleep(BULK_DELAY_MS);
  }
  return errors;
}

export interface VendorPriceResult {
  /** Items whose vendor buy price changed. */
  updated: number;
  /** Items that already had this price. */
  unchanged: number;
  /** Items fetched from Wowhead because they were not in the catalog yet. */
  imported: number;
  errors: string[];
}

/**
 * Store pasted vendor prices as vendor buy prices (REQ-1.5). Items not in the catalog are
 * imported from Wowhead first, one request at a time. Prices are stored as given, so paste
 * from a vendor that sells at the base price (DEC-8).
 */
export async function importVendorPrices(
  repo: Repo,
  rows: { itemId: number; price: number }[],
  onProgress: (done: number, total: number) => void,
  fetcher?: Fetcher,
): Promise<VendorPriceResult> {
  const result: VendorPriceResult = { updated: 0, unchanged: 0, imported: 0, errors: [] };
  let fetched = false;
  onProgress(0, rows.length);
  for (let i = 0; i < rows.length; i++) {
    const { itemId, price } = rows[i];
    let record = repo.listItems().find((it) => it.id === itemId);
    if (!record) {
      if (fetched) await sleep(BULK_DELAY_MS);
      fetched = true;
      try {
        record = await importItem(repo, itemId, { fetcher });
        result.imported++;
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (record) {
      if (record.vendorBuy === price) result.unchanged++;
      else {
        repo.saveItem({ ...record, vendorBuy: price, updatedAt: Date.now() });
        result.updated++;
      }
    }
    onProgress(i + 1, rows.length);
  }
  return result;
}
