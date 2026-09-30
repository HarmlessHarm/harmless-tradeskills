import { useLayoutEffect, useRef, useState } from 'react';
import { formatMoney } from '../engine/money';
import { manualSnapshot, parseLevels, type PriceSnapshot, summarize } from '../engine/snapshots';
import type { Copper } from '../engine/types';
import { useStore } from '../state/store';
import { ago, Money, MoneyInput, NumberInput } from './common';
import type { Row } from './FlipPage';

/** Snapshots listed under the chart; the chart shows all of them. */
const LIST_LIMIT = 8;

/**
 * AH prices for one watchlist row (#19 step 4): record what the AH shows, and see what was recorded.
 * Only the lowest price is required; the available count and a few more rows make the market value
 * trustworthy (DEC-23).
 */
export function PricesCard({ r }: { r: Row }) {
  const { mutate } = useStore();
  const [lowest, setLowest] = useState<Copper | null>(null);
  const [lowestQty, setLowestQty] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [more, setMore] = useState('');
  const parsed = parseLevels(more);

  const draft =
    lowest !== null
      ? manualSnapshot({ itemId: r.watch.itemId, ahType: r.settings.ahType, lowest, lowestQty, totalQty: total, more: parsed.levels, observedAt: Date.now() })
      : null;
  const preview = draft ? summarize(draft) : null;
  /** The rows as typed, lowest price first, for the "Read as" line (the snapshot merges equal prices). */
  const typedRows = lowest !== null ? [{ price: lowest, qty: Math.max(1, lowestQty ?? 1) }, ...parsed.levels] : [];
  const canSave = draft !== null && parsed.errors.length === 0;

  const save = () => {
    if (!draft || !canSave) return;
    mutate((repo) => repo.addSnapshot({ ...draft, observedAt: Date.now() }));
    setLowest(null);
    setLowestQty(null);
    setTotal(null);
    setMore('');
  };
  const remove = (s: PriceSnapshot) => {
    if (s.id === undefined) return;
    if (!confirm(`Delete the price seen ${new Date(s.observedAt).toLocaleString()}?`)) return;
    mutate((repo) => repo.deleteSnapshot(s.id!));
  };

  const { stats } = r;
  const recent = [...r.snaps].reverse().slice(0, LIST_LIMIT);

  return (
    <div className="prices-card">
      <h4>AH prices ({r.settings.ahType === 'neutral' ? 'neutral' : 'faction'})</h4>
      <form
        className="record-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label>
          Lowest price
          <MoneyInput value={lowest} onChange={setLowest} placeholder="e.g. 56c" />
        </label>
        <label>
          Qty at it
          <NumberInput value={lowestQty} onChange={setLowestQty} min={1} step={1} placeholder="1" />
        </label>
        <label>
          Available
          <NumberInput value={total} onChange={setTotal} min={1} step={1} placeholder="total" />
        </label>
        <label className="grow">
          More rows (optional)
          <input value={more} onChange={(e) => setMore(e.target.value)} placeholder="450x58c 900x61c" className={parsed.errors.length ? 'bad' : ''} />
        </label>
        <button type="submit" className="primary" disabled={!canSave}>
          Save
        </button>
      </form>
      {draft && parsed.errors.length === 0 && (parsed.levels.length > 0 || lowestQty !== null) && (
        <p className="small muted record-echo">
          Read as: {typedRows.map((l) => `${l.qty} @ ${formatMoney(l.price)}`).join(' · ')}
          {total !== null && draft.totalQty !== null && draft.totalQty > total && (
            <span className="warn">
              {' '}
              · The rows hold {draft.totalQty} units but Available says {total}: using {draft.totalQty}.
            </span>
          )}
        </p>
      )}
      <p className="small muted record-hint">
        {parsed.errors.length > 0 ? (
          <span className="neg">{parsed.errors.join(' · ')}. Rows are quantity x price, like 450x58c.</span>
        ) : preview?.marketValue != null ? (
          <>
            Market value <Money value={preview.marketValue} />{' '}
            {preview.confidence === 'solid'
              ? `(solid: the average of the cheapest 15–30% of ${draft?.totalQty} units; pricier rows do not count)`
              : '(partial: add Available and more rows until they cover 15% of it)'}
          </>
        ) : (
          'From the AH search result: the lowest price and how many are available. More rows make the market value solid.'
        )}
      </p>

      <dl className="obs-stats">
        <div>
          <dt>Last low</dt>
          <dd>
            <Money value={stats.last?.price} />
          </dd>
        </div>
        <div>
          <dt>Min</dt>
          <dd>
            <Money value={stats.min} />
          </dd>
        </div>
        <div>
          <dt>Typical</dt>
          <dd>
            <Money value={stats.typical} />
          </dd>
        </div>
        <div className={stats.n < 5 ? 'thin' : ''} title={stats.n < 5 ? 'Too few snapshots to trust the typical price' : undefined}>
          <dt>n</dt>
          <dd>{stats.n}</dd>
        </div>
      </dl>

      {r.snaps.length === 0 ? (
        <p className="muted small">No prices recorded for this item on the {r.settings.ahType} AH yet.</p>
      ) : (
        <>
          <PriceChart snaps={r.snaps} typical={stats.typical} buyBelow={r.row.buyBelow} />
          <table className="obs-list">
            <caption className="sr-only">Recorded prices, newest first</caption>
            <thead>
              <tr>
                <th>When</th>
                <th className="r">Lowest</th>
                <th className="r">Market value</th>
                <th className="r">Available</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => {
                const sum = summarize(s);
                return (
                  <tr key={s.uid}>
                    <td title={new Date(s.observedAt).toLocaleString()}>
                      {ago(s.observedAt)} {s.source !== 'manual' && <span className="badge">{s.source}</span>}
                      {s.origin && (
                        <span className="badge shared" title={`Added from ${s.origin}`}>
                          shared
                        </span>
                      )}
                    </td>
                    <td className="r">
                      <Money value={sum.minPrice} />
                      {sum.minQty !== null && sum.minQty > 1 && <span className="muted"> ×{sum.minQty}</span>}
                    </td>
                    <td className="r">
                      <Money value={sum.marketValue} />
                      {sum.confidence === 'partial' && <span className="muted small"> partial</span>}
                    </td>
                    <td className="r">{s.totalQty ?? <span className="muted">-</span>}</td>
                    <td className="actions">
                      <button className="row-icon delete" onClick={() => remove(s)} title="Delete this price" aria-label={`Delete price from ${new Date(s.observedAt).toLocaleString()}`}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {r.snaps.length > LIST_LIMIT && <p className="muted small">Showing the latest {LIST_LIMIT} of {r.snaps.length}.</p>}
        </>
      )}
      <p className="hint small muted">Prices typed in by hand are thin and biased toward when you happened to look. Addon scans will land in the same history.</p>
    </div>
  );
}

// Chart ---------------------------------------------------------------------

const HEIGHT = 96;
const PAD = { top: 10, right: 112, bottom: 18, left: 46 };

/** Width of an element, kept up to date. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Lowest price per snapshot over time, one dot each, against the typical price and "buy below".
 * A filled dot has a solid market value; a hollow dot is partial. Hover or focus a dot for its numbers.
 */
function PriceChart({ snaps, typical, buyBelow }: { snaps: PriceSnapshot[]; typical: Copper | null; buyBelow: Copper | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const points = snaps
    .map((s) => ({ s, sum: summarize(s) }))
    .filter((p) => p.sum.minPrice !== null)
    .map((p) => ({ ...p, price: p.sum.minPrice! }));

  const values = [...points.map((p) => p.price), ...(typical !== null ? [typical] : []), ...(buyBelow !== null ? [buyBelow] : [])];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const span = hi - lo || Math.max(1, hi * 0.1);
  lo = Math.max(0, lo - span * 0.12);
  hi = hi + span * 0.12;
  const t0 = points[0]?.s.observedAt ?? 0;
  const t1 = points[points.length - 1]?.s.observedAt ?? 0;
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

  const refs = [
    typical !== null && { key: 'typical', label: `typical ${formatMoney(typical)}`, value: typical, cls: 'ref-typical' },
    buyBelow !== null && { key: 'buy', label: `buy below ${formatMoney(buyBelow)}`, value: buyBelow, cls: 'ref-buy' },
  ].filter((v) => v !== false);
  // Keep the two reference labels apart: the higher one sits above its line, the lower one below.
  const [upper] = [...refs].sort((a, b) => b.value - a.value);
  const hovered = hover !== null ? points[hover] : null;
  const summary = `${points.length} prices from ${new Date(t0).toLocaleDateString()} to ${new Date(t1).toLocaleDateString()}, lowest ${formatMoney(Math.min(...points.map((p) => p.price)))}`;

  return (
    <div className="price-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={summary}>
          {[hi, lo].map((v) => (
            <g key={v}>
              <line className="grid" x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} />
              <text className="axis" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
                {formatMoney(Math.round(v))}
              </text>
            </g>
          ))}
          {refs.map((ref) => (
            <g key={ref.key} className={ref.cls}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(ref.value)} y2={y(ref.value)} />
              <text className="axis" x={PAD.left + plotW + 6} y={y(ref.value) + (ref === upper && refs.length > 1 ? -2 : 10)}>
                {ref.label}
              </text>
            </g>
          ))}
          {points.length > 1 && (
            <>
              <text className="axis" x={PAD.left} y={HEIGHT - 4}>
                {new Date(t0).toLocaleDateString()}
              </text>
              <text className="axis" x={PAD.left + plotW} y={HEIGHT - 4} textAnchor="end">
                {new Date(t1).toLocaleDateString()}
              </text>
            </>
          )}
          {points.map((p, i) => (
            <g key={p.s.uid}>
              <circle className={`dot ${p.sum.confidence === 'solid' ? 'solid' : 'partial'}`} cx={x(p.s.observedAt)} cy={y(p.price)} r={4} />
              <circle
                className="hit"
                cx={x(p.s.observedAt)}
                cy={y(p.price)}
                r={12}
                tabIndex={0}
                aria-label={`${formatMoney(p.price)} on ${new Date(p.s.observedAt).toLocaleString()}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          ))}
        </svg>
      )}
      {hovered && (
        <div
          className="chart-tip"
          style={{ left: Math.min(x(hovered.s.observedAt), width - 150), top: Math.max(0, y(hovered.price) - 58) }}
          role="status"
        >
          <strong>
            {formatMoney(hovered.price)}
            {hovered.sum.minQty !== null && hovered.sum.minQty > 1 ? ` ×${hovered.sum.minQty}` : ''}
          </strong>
          <span>{new Date(hovered.s.observedAt).toLocaleString()}</span>
          <span>
            market value {formatMoney(hovered.sum.marketValue)} · {hovered.sum.confidence}
          </span>
        </div>
      )}
      <p className="chart-key small muted">
        <span className="key-dot solid" /> lowest price, solid <span className="key-dot partial" /> partial (few rows)
      </p>
    </div>
  );
}
