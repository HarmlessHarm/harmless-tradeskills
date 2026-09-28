import { parseMoney } from './money';
import type { AhPrice, AhPriceRule, AhType, Copper } from './types';

/**
 * AH price snapshots (DEC-23). A snapshot is the cheap end of the order book for one item at one
 * moment: rows of (price, qty), plus the total quantity on the AH when known. Stats are derived from
 * the rows, so the formulas can change without touching stored data.
 */

export interface PriceLevel {
  /** Price per item. */
  price: Copper;
  qty: number;
}

export type SnapshotSource = 'manual' | 'addon';

/** 'solid': the rows cover enough of the book for a market value. 'partial': a guess from fewer rows. */
export type Confidence = 'solid' | 'partial';

export interface PriceSnapshot {
  /** Database id; absent before saving. */
  id?: number;
  /** Stable id used to de-duplicate re-imported or shared snapshots. */
  uid: string;
  itemId: number;
  observedAt: number;
  ahType: AhType;
  source: SnapshotSource;
  /** Units on the AH, when known (the search result's available count). */
  totalQty: number | null;
  /** Ascending by price. */
  levels: PriceLevel[];
  /** True when `levels` does not hold the whole book (manual entry, or a trimmed scan). */
  truncated: boolean;
}

export interface SnapshotSummary {
  minPrice: Copper | null;
  minQty: number | null;
  marketValue: Copper | null;
  confidence: Confidence | null;
}

export interface MarketValueOptions {
  /** Share of all units that is always included, cheapest first. */
  minShare: number;
  /** Share of all units that may be included. */
  maxShare: number;
  /** Past `minShare`, stop at the first price step up of more than this fraction. */
  maxJump: number;
}

export const MARKET_VALUE_DEFAULTS: MarketValueOptions = { minShare: 0.15, maxShare: 0.3, maxJump: 0.2 };

/** Sorts rows by price, merges rows with the same price and drops empty or invalid ones. */
export function normalizeLevels(levels: PriceLevel[]): PriceLevel[] {
  const byPrice = new Map<Copper, number>();
  for (const { price, qty } of levels) {
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price < 0 || qty <= 0) continue;
    const p = Math.round(price);
    byPrice.set(p, (byPrice.get(p) ?? 0) + Math.floor(qty));
  }
  return [...byPrice].filter(([, qty]) => qty > 0).sort((a, b) => a[0] - b[0]).map(([price, qty]) => ({ price, qty }));
}

const unitsIn = (levels: PriceLevel[]) => levels.reduce((s, l) => s + l.qty, 0);

/**
 * Market value: the quantity-weighted mean price of the cheapest units, ignoring overpriced
 * listings. Takes the cheapest `minShare` of all units, then continues up to `maxShare` until the
 * price jumps by more than `maxJump` from one row to the next. Everything above is ignored, so a
 * handful of listings at silly prices does not move it.
 *
 * With a known total quantity and rows covering at least `minShare` of it, the value is 'solid'.
 * Otherwise (a few rows typed in by hand) it is the mean of the given rows and 'partial'.
 */
export function marketValue(
  levels: PriceLevel[],
  totalQty: number | null,
  truncated: boolean,
  opts: MarketValueOptions = MARKET_VALUE_DEFAULTS,
): { value: Copper; confidence: Confidence } | null {
  const rows = normalizeLevels(levels);
  const listed = unitsIn(rows);
  if (listed === 0) return null;
  // Without a total, a complete book is its own total; a truncated one has an unknown total.
  const total = totalQty !== null && totalQty >= listed ? totalQty : truncated ? null : listed;
  if (total === null) return { value: weightedMean(rows, listed), confidence: 'partial' };

  const minUnits = Math.max(1, Math.ceil(total * opts.minShare));
  const maxUnits = Math.max(minUnits, Math.floor(total * opts.maxShare));
  if (listed < minUnits) return { value: weightedMean(rows, listed), confidence: 'partial' };

  let taken = 0;
  let sum = 0;
  let prev: Copper | null = null;
  for (const { price, qty } of rows) {
    if (taken >= minUnits && prev !== null && price > prev * (1 + opts.maxJump)) break;
    const take = Math.min(qty, maxUnits - taken);
    taken += take;
    sum += take * price;
    prev = price;
    if (taken >= maxUnits) break;
  }
  return { value: Math.round(sum / taken), confidence: 'solid' };
}

function weightedMean(rows: PriceLevel[], units: number): Copper {
  return Math.round(rows.reduce((s, l) => s + l.price * l.qty, 0) / units);
}

/** The numbers stored next to a snapshot, derived from its rows. */
export function summarize(s: Pick<PriceSnapshot, 'levels' | 'totalQty' | 'truncated'>): SnapshotSummary {
  const rows = normalizeLevels(s.levels);
  const mv = marketValue(rows, s.totalQty, s.truncated);
  return {
    minPrice: rows[0]?.price ?? null,
    minQty: rows[0]?.qty ?? null,
    marketValue: mv?.value ?? null,
    confidence: mv?.confidence ?? null,
  };
}

/**
 * Keeps only the part of a full book worth storing: the cheapest half of the units, or everything
 * up to twice the market value, whichever reaches further. The rest is overpriced noise. Returns
 * whether rows were dropped, which callers store as `truncated`.
 */
export function trimLevels(levels: PriceLevel[]): { levels: PriceLevel[]; truncated: boolean } {
  const rows = normalizeLevels(levels);
  const total = unitsIn(rows);
  const mv = marketValue(rows, total, false);
  if (!mv) return { levels: rows, truncated: false };
  const halfUnits = Math.ceil(total / 2);
  const kept: PriceLevel[] = [];
  let units = 0;
  for (const row of rows) {
    if (units >= halfUnits && row.price > 2 * mv.value) break;
    kept.push(row);
    units += row.qty;
  }
  return { levels: kept, truncated: kept.length < rows.length };
}

export interface PriceStats {
  /** Number of snapshots. Shown next to every typical price: manual data is thin. */
  n: number;
  /** Snapshots whose market value is 'solid'. */
  nSolid: number;
  /** Cheapest row of the most recent snapshot. */
  last: { price: Copper; qty: number; observedAt: number } | null;
  /** Cheapest price seen in any snapshot. */
  min: Copper | null;
  /** Median market value, where a partial snapshot counts half. The price to relist at. */
  typical: Copper | null;
}

/** Stats over an item's snapshots. Callers filter by item, AH type and period first. */
export function priceStats(snapshots: PriceSnapshot[]): PriceStats {
  const sorted = [...snapshots].sort((a, b) => a.observedAt - b.observedAt);
  const summaries = sorted.map((s) => ({ s, sum: summarize(s) }));
  const withMin = summaries.filter((x) => x.sum.minPrice !== null);
  const lastWithMin = withMin[withMin.length - 1];
  const values = summaries
    .filter((x) => x.sum.marketValue !== null)
    .map((x) => ({ value: x.sum.marketValue!, weight: x.sum.confidence === 'solid' ? 1 : 0.5 }));
  return {
    n: snapshots.length,
    nSolid: summaries.filter((x) => x.sum.confidence === 'solid').length,
    last: lastWithMin ? { price: lastWithMin.sum.minPrice!, qty: lastWithMin.sum.minQty!, observedAt: lastWithMin.s.observedAt } : null,
    min: withMin.length ? Math.min(...withMin.map((x) => x.sum.minPrice!)) : null,
    typical: weightedMedian(values),
  };
}

/** The value where the cumulative weight reaches half; the mean of the two middle values on an exact tie. */
export function weightedMedian(values: { value: number; weight: number }[]): number | null {
  const rows = values.filter((v) => v.weight > 0).sort((a, b) => a.value - b.value);
  const total = rows.reduce((s, v) => s + v.weight, 0);
  if (total === 0) return null;
  let acc = 0;
  for (let i = 0; i < rows.length; i++) {
    acc += rows[i].weight;
    if (acc > total / 2 + 1e-9) return rows[i].value;
    if (Math.abs(acc - total / 2) < 1e-9) return Math.round((rows[i].value + rows[i + 1].value) / 2);
  }
  return rows[rows.length - 1].value;
}

/**
 * Reads order book rows typed by hand: "100x56c 450x58c", "20 x 1g 5s, 3@2g". Each row is a quantity,
 * an `x` (or `@`, `*`, `×`) and a price in money notation (a bare number is copper). Rows are separated
 * by spaces, commas, semicolons or new lines. Anything that is not a row is reported, not guessed.
 */
export function parseLevels(text: string): { levels: PriceLevel[]; errors: string[] } {
  const row = /(\d+)\s*[x×@*]\s*((?:\d+\s*[gsc](?![a-z])\s*)+|\d+(?!\d))/gi;
  const levels: PriceLevel[] = [];
  const errors: string[] = [];
  let last = 0;
  const leftover = (s: string) => {
    const junk = s.replace(/[\s,;]+/g, ' ').trim();
    if (junk) errors.push(`Not a row: "${junk}"`);
  };
  for (const m of text.matchAll(row)) {
    leftover(text.slice(last, m.index));
    last = m.index + m[0].length;
    const qty = Number(m[1]);
    const price = parseMoney(m[2]);
    if (price === null || qty <= 0) errors.push(`Not a row: "${m[0].trim()}"`);
    else levels.push({ price, qty });
  }
  leftover(text.slice(last));
  return { levels, errors };
}

export interface ManualSnapshotInput {
  itemId: number;
  ahType: AhType;
  /** Cheapest price shown, per item. */
  lowest: Copper;
  /** Units at the cheapest price; unknown counts as 1. */
  lowestQty: number | null;
  /** Units on the AH (the search result's available count). */
  totalQty: number | null;
  /** More rows typed in, see `parseLevels`. */
  more: PriceLevel[];
  observedAt: number;
  uid?: string;
}

/** A snapshot from prices typed in by hand. It is truncated unless its rows add up to the total. */
export function manualSnapshot(input: ManualSnapshotInput): PriceSnapshot {
  const levels = normalizeLevels([{ price: input.lowest, qty: Math.max(1, input.lowestQty ?? 1) }, ...input.more]);
  const units = unitsIn(levels);
  const totalQty = input.totalQty !== null && input.totalQty > 0 ? Math.max(input.totalQty, units) : null;
  return {
    uid: input.uid ?? `manual-${crypto.randomUUID()}`,
    itemId: input.itemId,
    observedAt: input.observedAt,
    ahType: input.ahType,
    source: 'manual',
    totalQty,
    levels,
    truncated: totalQty === null || units < totalQty,
  };
}

/**
 * One AH price per item and AH type for workflows and the Items page (DEC-27). 'latest': the newest
 * snapshot's market value (its lowest price when there is none). 'typical': the typical price over
 * all snapshots (`priceStats`), falling back to 'latest'.
 */
export function currentAhPrices(snapshots: PriceSnapshot[], rule: AhPriceRule): AhPrice[] {
  const groups = new Map<string, PriceSnapshot[]>();
  for (const s of snapshots) {
    const key = `${s.itemId}:${s.ahType}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: AhPrice[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.observedAt - b.observedAt);
    const newest = sorted[sorted.length - 1];
    const sum = summarize(newest);
    const latest = sum.marketValue ?? sum.minPrice;
    const price = rule === 'typical' ? (priceStats(sorted).typical ?? latest) : latest;
    if (price === null) continue;
    out.push({ itemId: newest.itemId, ahType: newest.ahType, price, observedAt: newest.observedAt, n: sorted.length });
  }
  return out;
}
