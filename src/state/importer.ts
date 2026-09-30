import type { Repo } from '../db/repo';
import type { ItemClass, ItemFields, ItemRecord, RecipeRecord } from '../engine/types';
import { fetchTooltip, parseItemTooltip, parseSpellTooltip, type Fetcher, type PastedRecipeRow, type WowheadRef } from '../wowhead/adapter';

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
    // Wowhead's tooltip has no profession or learning info, so keep what was set earlier (from a pasted recipe table or by hand).
    imported: {
      ...parsed.fields,
      profession: parsed.fields.profession ?? existing?.imported.profession ?? null,
      requiredSkill: existing?.imported.requiredSkill ?? null,
      learnedFrom: existing?.imported.learnedFrom ?? [],
      skillRange: existing?.imported.skillRange ?? null,
    },
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
  /** Recipes whose profession, required skill, source or skill range was set by this run. */
  learning: number;
  errors: string[];
  warnings: string[];
}

/**
 * Import a pasted list of items and spells one request at a time. Spells go first, because a
 * recipe import also pulls in its reagents and created item, which then need no separate request.
 */
export async function bulkImport(
  repo: Repo,
  refs: WowheadRef[],
  opts: { force: boolean; recipeRows?: PastedRecipeRow[]; fetcher?: Fetcher },
  onProgress: (done: number, total: number) => void,
): Promise<BulkResult> {
  const ordered = [...refs.filter((r) => r.type === 'spell'), ...refs.filter((r) => r.type === 'item')];
  const refKey = (r: WowheadRef) => `${r.type}:${r.id}`;
  const has = (r: WowheadRef) =>
    r.type === 'spell' ? repo.listRecipes().some((x) => x.spellId === r.id) : repo.listItems().some((it) => it.id === r.id);
  // Progress counts only what this run imports, the same number the Import button shows.
  const skip = new Set(opts.force ? [] : ordered.filter(has).map(refKey));
  const todo = ordered.filter((r) => !skip.has(refKey(r)));
  const done = new Set<string>();
  // A recipe import also brings in its reagents and created item, so pasted items it brought
  // in count as done right away instead of all at once at the end.
  const markPulledIn = () => {
    if (!opts.force) for (const r of todo) if (r.type === 'item' && !done.has(refKey(r)) && has(r)) done.add(refKey(r));
  };
  const result: BulkResult = { imported: 0, skipped: 0, learning: 0, errors: [], warnings: [] };
  const rowInfo = new Map((opts.recipeRows ?? []).map((r) => [r.spellId, r]));
  let fetched = false;
  onProgress(0, todo.length);
  for (const ref of ordered) {
    const k = refKey(ref);
    if (skip.has(k)) {
      result.skipped++;
    } else if (done.has(k)) {
      result.imported++;
    } else {
      if (fetched) await sleep(BULK_DELAY_MS);
      fetched = true;
      try {
        if (ref.type === 'spell') {
          const r = await importRecipe(repo, ref.id, { force: opts.force, fetcher: opts.fetcher });
          result.warnings.push(...r.warnings.map((w) => `${r.recipe.imported.name}: ${w}`));
          result.errors.push(...r.itemErrors);
        } else {
          await importItem(repo, ref.id, { force: opts.force, fetcher: opts.fetcher });
        }
        result.imported++;
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
      done.add(k);
      markPulledIn();
      onProgress(done.size, todo.length);
    }
    // Rows copied from a recipe table say the profession and how it is learned, also for recipes already imported.
    const info = ref.type === 'spell' ? rowInfo.get(ref.id) : undefined;
    if (info && setRecipeLearning(repo, info)) result.learning++;
  }
  return result;
}

/**
 * Store a recipe's profession and how it is learned, from a pasted recipe table row, as base
 * values so they are not shown as edits. Values the row does not have are kept. Returns whether
 * anything changed.
 */
export function setRecipeLearning(repo: Repo, row: PastedRecipeRow): boolean {
  const r = repo.listRecipes().find((x) => x.spellId === row.spellId);
  if (!r) return false;
  const next = {
    ...r.imported,
    profession: row.profession ?? r.imported.profession,
    requiredSkill: row.requiredSkill ?? r.imported.requiredSkill,
    learnedFrom: row.learnedFrom.length ? row.learnedFrom : r.imported.learnedFrom,
    skillRange: row.skillRange ?? r.imported.skillRange,
  };
  const same = (k: 'profession' | 'requiredSkill' | 'learnedFrom' | 'skillRange') => JSON.stringify(next[k]) === JSON.stringify(r.imported[k]);
  if (same('profession') && same('requiredSkill') && same('learnedFrom') && same('skillRange')) return false;
  repo.saveRecipe({ ...r, imported: next, updatedAt: Date.now() });
  return true;
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
 * Fill in the item's type from a pasted Type column, as a base value, where the tooltip gave none.
 * A type the tooltip did give is kept. Returns the same object when nothing changes.
 */
function withPastedType(fields: ItemFields, row: { type?: string | null; classId?: number | null }): ItemFields {
  const itemClass: ItemClass =
    fields.itemClass === 'other' && row.classId === 2 ? 'weapon' : fields.itemClass === 'other' && row.classId === 4 ? 'armor' : fields.itemClass;
  const subclass = fields.subclass ?? row.type ?? null;
  return itemClass === fields.itemClass && subclass === fields.subclass ? fields : { ...fields, itemClass, subclass };
}

/**
 * Store pasted vendor prices as vendor buy prices (REQ-1.5), and the pasted type where the item has none. Items not in the catalog are
 * imported from Wowhead first, one request at a time. Prices are stored as given, so paste
 * from a vendor that sells at the base price (DEC-8).
 */
export async function importVendorPrices(
  repo: Repo,
  rows: { itemId: number; price: number; type?: string | null; classId?: number | null }[],
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
      const imported = withPastedType(record.imported, rows[i]);
      if (record.vendorBuy === price && imported === record.imported) result.unchanged++;
      else {
        repo.saveItem({ ...record, imported, vendorBuy: price, updatedAt: Date.now() });
        if (record.vendorBuy === price) result.unchanged++;
        else result.updated++;
      }
    }
    onProgress(i + 1, rows.length);
  }
  return result;
}
