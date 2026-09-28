import type { Repo } from '../db/repo';
import type { Copper, ItemFields, ItemRecord, PriceObservation } from '../engine/types';

/** Record a new AH price observation, keeping the other field of the latest one. */
export function setAhPrice(
  repo: Repo,
  latest: PriceObservation | undefined,
  itemId: number,
  patch: { ahPrice?: Copper | null; ahPessimistic?: Copper | null },
): void {
  repo.addPrice({
    itemId,
    ahPrice: patch.ahPrice !== undefined ? patch.ahPrice : (latest?.ahPrice ?? null),
    ahPessimistic: patch.ahPessimistic !== undefined ? patch.ahPessimistic : (latest?.ahPessimistic ?? null),
    observedAt: Date.now(),
  });
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
