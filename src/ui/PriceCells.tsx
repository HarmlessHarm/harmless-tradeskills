import { useStore } from '../state/store';
import { setAhPrice, setVendorBuy } from '../state/actions';
import { Money, MoneyInput, PriceAge } from './common';

/** Inline AH price editor. Every edit is a new timestamped observation (REQ-4.1). */
export function AhPriceCell({ itemId, pessimistic = false }: { itemId: number; pessimistic?: boolean }) {
  const { prices, mutate } = useStore();
  const latest = prices.find((p) => p.itemId === itemId);
  const value = pessimistic ? (latest?.ahPessimistic ?? null) : (latest?.ahPrice ?? null);
  return (
    <MoneyInput
      value={value}
      placeholder={pessimistic ? 'min AH price' : 'AH price'}
      onChange={(v) => mutate((repo) => setAhPrice(repo, latest, itemId, pessimistic ? { ahPessimistic: v } : { ahPrice: v }))}
    />
  );
}

export function AhPriceAge({ itemId }: { itemId: number }) {
  const { prices } = useStore();
  return <PriceAge obs={prices.find((p) => p.itemId === itemId)} />;
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
