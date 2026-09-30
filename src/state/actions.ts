import type { Repo } from '../db/repo';
import { manualSnapshot } from '../engine/snapshots';
import type { AhType, Copper, ItemFields, ItemRecord } from '../engine/types';

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
