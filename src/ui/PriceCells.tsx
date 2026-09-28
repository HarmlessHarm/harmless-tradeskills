import { ahKey } from '../engine/prices';
import type { AhType } from '../engine/types';
import { recordAhPrice, setVendorBuy } from '../state/actions';
import { useStore } from '../state/store';
import { Money, MoneyInput, PriceAge } from './common';

/**
 * Inline AH price editor for one AH. Shows the price workflows use (the rule in Settings); every
 * edit records a price snapshot (REQ-4.1, DEC-27). Snapshots are history, so a price is not cleared,
 * only replaced by a newer one.
 */
export function AhPriceCell({ itemId, ahType = 'faction' }: { itemId: number; ahType?: AhType }) {
  const { engine, mutate } = useStore();
  const current = engine.ahPrices.get(ahKey(itemId, ahType));
  return (
    <MoneyInput
      value={current?.price ?? null}
      placeholder={ahType === 'neutral' ? 'neutral AH price' : 'AH price'}
      onChange={(v) => v !== null && mutate((repo) => recordAhPrice(repo, itemId, ahType, v))}
    />
  );
}

/** Inline editor for the min AH price: your worst-case sell price for the item (REQ-4.2). */
export function AhMinCell({ itemId }: { itemId: number }) {
  const { engine, mutate } = useStore();
  return (
    <MoneyInput value={engine.ahMins.get(itemId) ?? null} placeholder="min AH price" onChange={(v) => mutate((repo) => repo.setAhMin(itemId, v))} />
  );
}

export function AhPriceAge({ itemId, ahType = 'faction' }: { itemId: number; ahType?: AhType }) {
  const { engine } = useStore();
  const current = engine.ahPrices.get(ahKey(itemId, ahType));
  return <PriceAge observedAt={current?.observedAt} n={current?.n} />;
}

export function VendorBuyCell({ itemId }: { itemId: number }) {
  const { itemRecords, mutate } = useStore();
  const record = itemRecords.find((r) => r.id === itemId);
  if (!record) return <span className="muted">import item first</span>;
  return <MoneyInput value={record.vendorBuy} placeholder="vendor price" onChange={(v) => mutate((repo) => setVendorBuy(repo, record, v))} />;
}

export function VendorSellCell({ itemId }: { itemId: number }) {
  const { engine } = useStore();
  return <Money value={engine.items.get(itemId)?.vendorSell ?? null} />;
}
