import { useState } from 'react';
import { flip } from '../engine/ah';
import { formatMoney } from '../engine/money';
import type { AhType } from '../engine/types';
import { useStore } from '../state/store';
import { ItemPicker, Money, MoneyInput, NumberInput, Panel, Segmented } from './common';

/** AH flip calculator, no persistence (REQ-7). */
export function FlipPage() {
  const { config, engine, prices } = useStore();
  const [itemId, setItemId] = useState<number | null>(null);
  const [buy, setBuy] = useState<number | null>(null);
  const [sell, setSell] = useState<number | null>(null);
  const [qty, setQty] = useState<number | null>(1);
  const [ahType, setAhType] = useState<AhType>('faction');
  const [duration, setDuration] = useState(config.durations[1]?.key ?? config.durations[0]?.key ?? '');
  const [vendorOverride, setVendorOverride] = useState<number | null>(null);

  const item = itemId !== null ? engine.items.get(itemId) : undefined;
  const vendorSell = vendorOverride ?? item?.vendorSell ?? null;
  const n = Math.max(1, qty ?? 1);
  const r = buy !== null && sell !== null ? flip(config, { buyPrice: buy, sellPrice: sell, qty: n, vendorSellEach: vendorSell, durationKey: duration, ahType }) : null;
  const ahNow = itemId !== null ? prices.find((p) => p.itemId === itemId)?.ahPrice : null;

  return (
    <div className="stack narrow">
      <Panel title="AH flip">
        <p className="small muted">Prices are for the whole listing. The deposit is based on the item's vendor sell price and is lost when a listing expires.</p>
        <div className="form-grid">
          <label>
            Item (for the deposit)
            <ItemPicker
              value={itemId}
              onChange={(id) => {
                setItemId(id);
                setVendorOverride(null);
              }}
            />
          </label>
          <label>
            Vendor sell price each
            <MoneyInput value={vendorSell} onChange={setVendorOverride} placeholder={item ? 'unknown' : 'pick an item or type'} />
          </label>
          <label>
            Buy price
            <MoneyInput value={buy} onChange={setBuy} />
          </label>
          <label>
            Expected sell price
            <MoneyInput value={sell} onChange={setSell} placeholder={ahNow ? `AH price: ${formatMoney(ahNow)} each` : 'e.g. 1g 20s'} />
          </label>
          <label>
            Stack size
            <NumberInput value={qty} min={1} step={1} onChange={setQty} />
          </label>
          <label>
            Duration
            <select value={duration} onChange={(e) => setDuration(e.target.value)}>
              {config.durations.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Auction house
            <Segmented
              value={ahType}
              options={[
                { value: 'faction', label: 'Faction' },
                { value: 'neutral', label: 'Neutral' },
              ]}
              onChange={setAhType}
            />
          </label>
        </div>
      </Panel>
      {r ? (
        <Panel className="results">
          <div className="kpis">
            <div className="kpi kpi-worst">
              <span className="kpi-label">Failed listings it can absorb</span>
              <span className="kpi-value">
                {r.failedListingsAbsorbed === null ? 'any' : r.failedListingsAbsorbed < 0 ? <span className="neg">loses money</span> : r.failedListingsAbsorbed}
              </span>
              <span className="kpi-sub">relists before the flip stops paying</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Profit if it sells first time</span>
              <span className="kpi-value">
                <Money value={r.profitFirstListing} signed />
              </span>
              <span className="kpi-sub">
                after <Money value={r.cut} /> cut
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Cost per failed listing</span>
              <span className="kpi-value">
                <Money value={r.costPerFailedListing} />
              </span>
              <span className="kpi-sub">lost deposit</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Break-even sell price</span>
              <span className="kpi-value">
                <Money value={r.breakEvenSellPrice} />
              </span>
              <span className="kpi-sub">on the first listing</span>
            </div>
          </div>
        </Panel>
      ) : (
        <p className="muted small">Enter a buy and a sell price.</p>
      )}
    </div>
  );
}
