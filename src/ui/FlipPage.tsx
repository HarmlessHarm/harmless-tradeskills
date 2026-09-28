import { Fragment, useMemo, useState } from 'react';
import { flip, listingMode } from '../engine/ah';
import { rowSettings, watchlistItems, watchRow, type WatchItem, type WatchRow } from '../engine/flip';
import { formatMoney } from '../engine/money';
import { type PriceSnapshot, type PriceStats, priceStats } from '../engine/snapshots';
import type { AhType, Config, FlipFavorite, Item } from '../engine/types';
import { useStore } from '../state/store';
import { PricesCard } from './FlipPrices';
import { ago, ItemName, ItemPicker, Money, MoneyInput, NumberInput, Panel, Segmented } from './common';
import { SortHeader, sortRows, useSort, type SortValue } from './sorting';

type Settings = ReturnType<typeof rowSettings>;
type Filter = 'all' | 'favorites' | 'workflows';
type SortKey = 'name' | 'last' | 'typical' | 'n' | 'buyBelow' | 'sellAt' | 'margin' | 'relists';

/** Fewer snapshots than this and the typical price is a guess. */
const THIN_DATA = 5;

export interface Row {
  watch: WatchItem;
  item: Item | undefined;
  name: string;
  settings: Settings;
  /** Snapshots for the row's AH type, oldest first. */
  snaps: PriceSnapshot[];
  stats: PriceStats;
  row: WatchRow;
}

/**
 * AH flip watchlist (REQ-7, #19): favorites and the items workflows trade on the AH, one row each.
 * Clicking a row opens the quick calculator under it. Prices come from AH price snapshots (DEC-23).
 */
export function FlipPage() {
  const { config, engine, workflows, flipFavorites, priceSnapshots, mutate } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const sort = useSort<SortKey>('name');
  const margin = config.flipTargetMargin;

  const snapsByItem = useMemo(() => {
    const m = new Map<number, PriceSnapshot[]>();
    for (const s of priceSnapshots) m.set(s.itemId, [...(m.get(s.itemId) ?? []), s]);
    return m;
  }, [priceSnapshots]);

  const rows: Row[] = useMemo(
    () =>
      watchlistItems(engine, workflows, flipFavorites).map((watch) => {
        const item = engine.items.get(watch.itemId);
        const settings = rowSettings(config, watch.itemId, flipFavorites.find((f) => f.itemId === watch.itemId));
        const snaps = (snapsByItem.get(watch.itemId) ?? []).filter((s) => s.ahType === settings.ahType);
        const stats = priceStats(snaps);
        return { watch, item, name: item?.name ?? `#${watch.itemId}`, settings, snaps, stats, row: watchRow(config, item, settings, stats, margin) };
      }),
    [engine, workflows, flipFavorites, snapsByItem, config, margin],
  );

  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = sortRows(
    rows
      .filter((r) => filter === 'all' || (filter === 'favorites' ? r.watch.favorite : r.watch.workflows.length > 0))
      .filter((r) => terms.every((t) => r.name.toLowerCase().includes(t))),
    sort,
    (r, k): SortValue =>
      ({ name: r.name, last: r.row.lastLow, typical: r.row.typical, n: r.row.n, buyBelow: r.row.buyBelow, sellAt: r.row.sellAt, margin: r.row.marginPct, relists: r.row.relists })[k],
    (r) => r.name,
  );

  const saveAll = (next: FlipFavorite[]) => mutate((repo) => repo.saveFlipFavorites(next));
  /** Remember settings for an item. Items only on the list through a workflow are saved as non-favorites. */
  const save = (itemId: number, patch: Partial<FlipFavorite>) => {
    const current = flipFavorites.find((f) => f.itemId === itemId);
    if (current) return saveAll(flipFavorites.map((f) => (f === current ? { ...f, ...patch } : f)));
    const { favorite: _, ...defaults } = rowSettings(config, itemId, undefined);
    saveAll([...flipFavorites, { ...defaults, favorite: false, ...patch }]);
  };
  const toggleFavorite = (r: Row) => {
    // A favorite no workflow uses leaves the list, so its settings go too.
    if (r.watch.favorite && r.watch.workflows.length === 0) {
      if (open === r.watch.itemId) setOpen(null);
      return saveAll(flipFavorites.filter((f) => f.itemId !== r.watch.itemId));
    }
    save(r.watch.itemId, { favorite: !r.watch.favorite });
  };
  const add = (itemId: number | null) => {
    setAdding(null);
    if (itemId === null) return;
    save(itemId, { favorite: true });
    setOpen(itemId);
  };

  return (
    <div className="stack">
      <Panel
        title="Watchlist"
        actions={
          <>
            <input className="search" placeholder="Filter items" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Segmented
              value={filter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'favorites', label: 'Favorites' },
                { value: 'workflows', label: 'In workflows' },
              ]}
              onChange={setFilter}
            />
            <label className="inline small muted" title="Profit you want on a flip, as a share of what you pay. Sets 'Buy below'.">
              Target margin
              <NumberInput
                className="pct-input"
                value={Math.round(margin * 1000) / 10}
                min={0}
                step={1}
                onChange={(v) => mutate((repo) => repo.saveConfig({ ...config, flipTargetMargin: Math.max(0, v ?? 0) / 100 }))}
              />
              %
            </label>
            <ItemPicker value={adding} onChange={add} placeholder="Add item to watch" />
          </>
        }
      >
        <p className="small muted">
          Favorites plus every item a workflow buys or sells on the AH. Prices come from your AH price snapshots; <b>n</b> is how many there are, so a typical price with a
          small n is a guess. Click a row for the calculator.
          {config.ahRulesVerifiedAt === null && <span className="warn"> AH rules are not checked in game yet (Settings).</span>}
        </p>
        {rows.length === 0 ? (
          <p className="muted">Nothing to watch yet. Add an item above, or build a workflow that buys or sells on the AH.</p>
        ) : (
          <div className="table-wrap">
            <table className="table watchlist">
              <thead>
                <tr>
                  <th className="check" />
                  <SortHeader label="Item" k="name" sort={sort} />
                  <SortHeader label="Last seen low" k="last" sort={sort} className="r" />
                  <SortHeader label="Typical" k="typical" sort={sort} className="r" />
                  <SortHeader label="n" k="n" sort={sort} className="r tight" />
                  <SortHeader label="Buy below" k="buyBelow" sort={sort} className="r" />
                  <SortHeader label="Sell at" k="sellAt" sort={sort} className="r" />
                  <SortHeader label="Margin" k="margin" sort={sort} className="r" />
                  <SortHeader label="Relists to break even" k="relists" sort={sort} className="r" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const isOpen = open === r.watch.itemId;
                  return (
                    <Fragment key={r.watch.itemId}>
                      <tr className={`watch-row ${isOpen ? 'editing' : ''}`} onClick={() => setOpen(isOpen ? null : r.watch.itemId)} aria-expanded={isOpen}>
                        <td className="check">
                          <button
                            className={`row-icon fav ${r.watch.favorite ? 'on' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(r);
                            }}
                            title={r.watch.favorite ? 'Remove from favorites' : 'Add to favorites'}
                            aria-label={r.watch.favorite ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`}
                            aria-pressed={r.watch.favorite}
                          >
                            {r.watch.favorite ? '★' : '☆'}
                          </button>
                        </td>
                        <td className="nowrap">
                          <span className={`caret ${isOpen ? 'open' : ''}`} aria-hidden>
                            ▸
                          </span>
                          <ItemName id={r.watch.itemId} />
                          {r.watch.workflows.length > 0 && (
                            <span className="badge wf" title={`Used in: ${r.watch.workflows.join(', ')}`}>
                              workflow
                            </span>
                          )}
                          {r.settings.ahType === 'neutral' && <span className="badge">neutral</span>}
                        </td>
                        <td className={`r ${isDeal(r.row) ? 'deal' : ''}`} title={isDeal(r.row) ? 'At or under "buy below": worth buying' : undefined}>
                          <Money value={r.row.lastLow} />
                          {r.row.lastLowAt !== null && <span className="sub">{ago(r.row.lastLowAt)}</span>}
                        </td>
                        <td className="r">
                          <Money value={r.row.typical} />
                        </td>
                        <td className="r tight">
                          <NBadge n={r.row.n} />
                        </td>
                        <td className="r buy-below">
                          <Money value={r.row.buyBelow} />
                        </td>
                        <td className="r">
                          <Money value={r.row.sellAt} />
                          {r.row.sellAtIsTypical && <span className="sub">typical</span>}
                        </td>
                        <td className="r">
                          <Money value={r.row.margin} signed />
                          {r.row.marginPct !== null && <span className="sub">{Math.round(r.row.marginPct * 100)}%</span>}
                        </td>
                        <td className="r">
                          <Relists value={r.row.relists} known={r.row.margin !== null} />
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="editor-row">
                          <td colSpan={9}>
                            <div className="row-detail">
                              <QuickCalc r={r} config={config} targetMargin={margin} onChange={(patch) => save(r.watch.itemId, patch)} />
                              <PricesCard r={r} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

const isDeal = (row: WatchRow) => row.lastLow !== null && row.buyBelow !== null && row.lastLow <= row.buyBelow;

function NBadge({ n }: { n: number }) {
  const thin = n < THIN_DATA;
  return (
    <span className={`n-badge ${thin ? 'thin' : ''}`} title={`${n} price snapshot${n === 1 ? '' : 's'}${thin ? ': too few to trust the typical price' : ''}`}>
      {n}
    </span>
  );
}

function Relists({ value, known }: { value: number | null; known: boolean }) {
  if (!known) return <span className="money muted">-</span>;
  if (value === null) return <span>any</span>;
  if (value < 0) return <span className="neg">loses money</span>;
  return <b>{value}</b>;
}

/** The calculator under an expanded row. Every input is remembered for the item. */
function QuickCalc({ r, config, targetMargin, onChange }: { r: Row; config: Config; targetMargin: number; onChange: (patch: Partial<FlipFavorite>) => void }) {
  const { settings, row, item } = r;
  const mode = listingMode(config, item?.itemClass);
  const buy = settings.buyPrice ?? row.lastLow;
  const sell = row.sellAt;
  const res =
    buy !== null && sell !== null
      ? flip(config, { buyPrice: buy, sellPrice: sell, vendorSellEach: item?.vendorSell ?? null, durationKey: settings.durationKey, ahType: settings.ahType, qty: settings.qty, mode })
      : null;
  const lot = settings.qty > 1;
  const duration = config.durations.find((d) => d.key === settings.durationKey)?.label ?? settings.durationKey;
  const posting = mode === 'lot' ? (lot ? `one auction of ${settings.qty}` : 'one auction') : lot ? `${settings.qty} auctions of one` : 'one auction';

  return (
    <div className="quick-calc">
      <div className="calc-inputs">
        <label>
          I see it at (each)
          <MoneyInput
            value={settings.buyPrice}
            onChange={(v) => onChange({ buyPrice: v })}
            placeholder={row.lastLow !== null ? `last low: ${formatMoney(row.lastLow)}` : 'e.g. 42s'}
          />
        </label>
        <label>
          Sell at (each)
          <MoneyInput
            value={settings.sellPrice}
            onChange={(v) => onChange({ sellPrice: v })}
            placeholder={row.typical !== null ? `typical: ${formatMoney(row.typical)}` : 'e.g. 58s'}
          />
        </label>
        <label>
          Quantity
          <NumberInput value={settings.qty} min={1} step={1} onChange={(v) => onChange({ qty: Math.max(1, Math.floor(v ?? 1)) })} />
        </label>
        <label>
          Auction house
          <Segmented<AhType>
            value={settings.ahType}
            options={[
              { value: 'faction', label: 'Faction' },
              { value: 'neutral', label: 'Neutral' },
            ]}
            onChange={(v) => onChange({ ahType: v })}
          />
        </label>
        <label>
          Duration
          <Segmented value={settings.durationKey} options={config.durations.map((d) => ({ value: d.key, label: d.label }))} onChange={(v) => onChange({ durationKey: v })} />
        </label>
      </div>

      {res && buy !== null ? (
        <>
          <Verdict buy={buy} buyBelow={row.buyBelow} />
          <dl className="calc-kv">
            <dt>Profit per item if it sells first time</dt>
            <dd>
              <Money value={res.profitFirstListing} signed />
              {lot && (
                <span className="muted small">
                  {' '}
                  (<Money value={res.profitTotal} signed /> for {res.qty})
                </span>
              )}
            </dd>
            <dt>Most to pay for a {Math.round(targetMargin * 100)}% margin</dt>
            <dd>{row.buyBelow === null ? <span className="neg">no price reaches it</span> : <Money value={row.buyBelow} />}</dd>
            <dt>AH cut per item</dt>
            <dd>
              <Money value={res.cut} />
            </dd>
            <dt>
              Deposit, {duration}, {posting}
            </dt>
            <dd>
              <Money value={res.deposit} />
              {item?.vendorSell == null && <span className="muted small"> (vendor price unknown: minimum)</span>}
            </dd>
            <dt>{lot ? 'Times the lot can expire' : 'Relists'} before it stops paying</dt>
            <dd>
              <Relists value={res.failedListingsAbsorbed} known />
            </dd>
            <dt>Break-even sell price</dt>
            <dd>
              <Money value={res.breakEvenSellPrice} />
            </dd>
          </dl>
        </>
      ) : (
        <p className="muted small">{sell === null ? 'Enter a sell price: there is no typical price for this item yet.' : 'Enter the price you see on the AH.'}</p>
      )}
    </div>
  );
}

function Verdict({ buy, buyBelow }: { buy: number; buyBelow: number | null }) {
  if (buyBelow === null) return <p className="verdict bad">No buy price makes the target margin at this sell price.</p>;
  const diff = buyBelow - buy;
  return diff >= 0 ? (
    <p className="verdict good">
      <span className="pill deal">Buy</span> <Money value={diff} /> under "buy below"
    </p>
  ) : (
    <p className="verdict bad">
      <span className="pill skip">Too high</span> <Money value={-diff} /> over "buy below"
    </p>
  );
}
