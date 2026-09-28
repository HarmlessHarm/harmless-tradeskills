import { useState } from 'react';
import { flip, listingMode } from '../engine/ah';
import { formatMoney } from '../engine/money';
import type { AhType, FlipFavorite } from '../engine/types';
import { useStore } from '../state/store';
import { ItemName, ItemPicker, Money, MoneyInput, NumberInput, Panel, Segmented } from './common';

type FlipSettings = Omit<FlipFavorite, 'itemId'>;

/**
 * AH flip calculator (REQ-7). Prices are per item. How the quantity is posted (one auction for the lot,
 * or one per piece) follows the item's class and the AH rules in Settings (DEC-22).
 * Favorite items remember the prices and settings last used for them.
 */
export function FlipPage() {
  const { config, engine, prices, flipFavorites, mutate } = useStore();
  const defaultDuration = config.durations[1]?.key ?? config.durations[0]?.key ?? '';
  const [itemId, setItemId] = useState<number | null>(null);
  const [buy, setBuy] = useState<number | null>(null);
  const [sell, setSell] = useState<number | null>(null);
  const [ahType, setAhType] = useState<AhType>('faction');
  const [duration, setDuration] = useState(defaultDuration);
  const [qty, setQty] = useState(1);

  const item = itemId !== null ? engine.items.get(itemId) : undefined;
  const vendorSell = item?.vendorSell ?? null;
  const favorite = flipFavorites.find((f) => f.itemId === itemId);
  const mode = listingMode(config, item?.itemClass);
  const r = buy !== null && sell !== null ? flip(config, { buyPrice: buy, sellPrice: sell, vendorSellEach: vendorSell, durationKey: duration, ahType, qty, mode }) : null;
  const lot = qty > 1;
  const ahNow = itemId !== null ? prices.find((p) => p.itemId === itemId)?.ahPrice : null;

  const saveFavorites = (next: FlipFavorite[]) => mutate((repo) => repo.saveFlipFavorites(next));
  /** Edits to a favorite's inputs are remembered on the favorite. */
  const change = (patch: Partial<FlipSettings>) => {
    if ('buyPrice' in patch) setBuy(patch.buyPrice ?? null);
    if ('sellPrice' in patch) setSell(patch.sellPrice ?? null);
    if (patch.durationKey !== undefined) setDuration(patch.durationKey);
    if (patch.ahType !== undefined) setAhType(patch.ahType);
    if (patch.qty !== undefined) setQty(patch.qty);
    if (favorite) saveFavorites(flipFavorites.map((f) => (f === favorite ? { ...f, ...patch } : f)));
  };
  const load = (fav: FlipFavorite) => {
    setItemId(fav.itemId);
    setBuy(fav.buyPrice);
    setSell(fav.sellPrice);
    setAhType(fav.ahType);
    setQty(fav.qty ?? 1);
    setDuration(config.durations.some((d) => d.key === fav.durationKey) ? fav.durationKey : defaultDuration);
  };
  const pickItem = (id: number | null) => {
    const fav = flipFavorites.find((f) => f.itemId === id);
    if (fav) return load(fav);
    setItemId(id);
  };
  const toggleFavorite = () => {
    if (itemId === null) return;
    if (favorite) saveFavorites(flipFavorites.filter((f) => f !== favorite));
    else saveFavorites([...flipFavorites, { itemId, buyPrice: buy, sellPrice: sell, durationKey: duration, ahType, qty }]);
  };

  return (
    <div className="stack narrow">
      {flipFavorites.length > 0 && (
        <Panel title="Favorites">
          <div className="chips">
            {flipFavorites.map((f) => (
              <span key={f.itemId} className={`chip fav-chip ${f.itemId === itemId ? 'on' : ''}`}>
                <button className="link-btn" onClick={() => load(f)} title="Load this flip">
                  <ItemName id={f.itemId} />
                </button>
                <button
                  className="row-icon delete"
                  onClick={() => saveFavorites(flipFavorites.filter((x) => x !== f))}
                  title="Remove from favorites"
                  aria-label={`Remove favorite ${engine.items.get(f.itemId)?.name ?? f.itemId}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </Panel>
      )}
      <Panel title="AH flip">
        <p className="small muted">
          Prices are per item. {mode === 'lot' ? 'This item is posted as one auction for the whole quantity, with one deposit.' : 'This item is posted one auction per piece, each with its own deposit.'}{' '}
          The deposit comes from the vendor sell price, is {config.depositRefundedOnSale ? 'refunded on sale' : 'kept by the AH even on sale'} and is lost when the auction expires.
          {config.ahRulesVerifiedAt === null && <span className="warn"> AH rules are not checked in game yet (Settings).</span>}
        </p>
        <div className="form-grid flip-form">
          <label className="span-2">
            Item
            <span className="picker-row">
              <ItemPicker value={itemId} onChange={pickItem} />
              <button
                className={`row-icon fav ${favorite ? 'on' : ''}`}
                disabled={itemId === null}
                onClick={toggleFavorite}
                title={favorite ? 'Remove from favorites' : 'Add to favorites (remembers prices and settings)'}
                aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={!!favorite}
              >
                {favorite ? '★' : '☆'}
              </button>
            </span>
          </label>
          <label>
            Buy price each
            <MoneyInput value={buy} onChange={(v) => change({ buyPrice: v })} />
          </label>
          <label>
            Sell price each
            <MoneyInput value={sell} onChange={(v) => change({ sellPrice: v })} placeholder={ahNow ? `AH price: ${formatMoney(ahNow)}` : 'e.g. 1g 20s'} />
          </label>
          <label>
            Quantity
            <NumberInput value={qty} min={1} step={1} onChange={(v) => change({ qty: Math.max(1, Math.floor(v ?? 1)) })} />
          </label>
          <label>
            Duration
            <select value={duration} onChange={(e) => change({ durationKey: e.target.value })}>
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
              onChange={(v) => change({ ahType: v })}
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
              <span className="kpi-sub">{lot ? 'times the whole lot can expire' : 'relists'} before the flip stops paying</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Profit per item if it sells first time</span>
              <span className="kpi-value">
                <Money value={r.profitFirstListing} signed />
              </span>
              <span className="kpi-sub">
                after <Money value={r.cut} /> cut{lot && <>, <Money value={r.profitTotal} signed /> for all {r.qty}</>}
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Cost per failed listing</span>
              <span className="kpi-value">
                <Money value={r.costPerFailedListing} />
              </span>
              <span className="kpi-sub">
                lost deposit{lot ? (r.mode === 'lot' ? ' for the lot (one auction)' : ` for ${r.qty} auctions`) : ''}
                {vendorSell === null && <> ({item ? 'vendor price unknown' : 'no item picked'}, minimum deposit)</>}
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Break-even sell price</span>
              <span className="kpi-value">
                <Money value={r.breakEvenSellPrice} />
              </span>
              <span className="kpi-sub">per item, on the first listing</span>
            </div>
          </div>
        </Panel>
      ) : (
        <p className="muted small">Enter a buy and a sell price.</p>
      )}
    </div>
  );
}
