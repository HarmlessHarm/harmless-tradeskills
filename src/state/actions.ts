import type { Repo } from '../db/repo';
import { manualSnapshot } from '../engine/snapshots';
import type { AhType, Copper, ItemFields, ItemRecord, RecipeRecord } from '../engine/types';

/** Record an AH price typed in a price cell: a manual price snapshot of one row (REQ-4.1, DEC-27). */
export function recordAhPrice(repo: Repo, itemId: number, ahType: AhType, price: Copper): void {
  repo.addSnapshot(manualSnapshot({ itemId, ahType, lowest: price, lowestQty: null, totalQty: null, more: [], observedAt: Date.now() }));
}

export function setVendorBuy(repo: Repo, record: ItemRecord, vendorBuy: Copper | null): void {
  repo.saveItem({ ...record, vendorBuy, updatedAt: Date.now() });
}

/** Set or clear (value undefined) a manual override on an item field (DEC-6). */
export function setItemOverride<K extends keyof ItemFields>(repo: Repo, record: ItemRecord, key: K, value: ItemFields[K] | undefined): void {
  const overrides = { ...record.overrides };
  if (value === undefined) delete overrides[key];
  else overrides[key] = value;
  repo.saveItem({ ...record, overrides, updatedAt: Date.now() });
}

export function createManualItem(repo: Repo, id: number, name: string): void {
  const now = Date.now();
  repo.saveItem({
    id,
    imported: { name, quality: 1, itemLevel: null, itemClass: 'other', subclass: null, vendorSell: null, icon: null },
    overrides: {},
    vendorBuy: null,
    source: 'manual',
    fetchedAt: null,
    updatedAt: now,
    rawTooltip: null,
  });
}

/**
 * Set (or clear, with null) the profession on many recipes. Stored as the base value and any
 * profession override is dropped, so the new value is what shows. Returns how many changed.
 */
export function setProfession(repo: Repo, records: RecipeRecord[], profession: string | null): number {
  let changed = 0;
  for (const r of records) {
    const overrides = { ...r.overrides };
    const hadOverride = 'profession' in overrides;
    delete overrides.profession;
    if (!hadOverride && r.imported.profession === profession) continue;
    repo.saveRecipe({ ...r, imported: { ...r.imported, profession }, overrides, updatedAt: Date.now() });
    changed++;
  }
  return changed;
}
