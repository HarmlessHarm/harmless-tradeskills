import { flip, listingMode, netOnSale, postingDeposit, saleCost } from './ah';
import type { PriceStats } from './snapshots';
import type { AhType, Config, Copper, FlipFavorite, Item, ListingMode, Workflow } from './types';
import { buySourceFor, dispositionFor, type EngineData, resolveStep } from './workflow';

/**
 * The AH flip watchlist (#19): favorites plus items workflows trade on the AH, each with the numbers
 * needed to decide whether a price seen on the AH is worth buying at.
 */

export interface MaxBuyInput {
  sellPrice: Copper;
  vendorSellEach: Copper | null;
  durationKey: string;
  ahType: AhType;
  qty: number;
  mode: ListingMode;
  /** Wanted profit as a fraction of the buy price, e.g. 0.15. */
  targetMargin: number;
}

/**
 * The most to pay per item and still make `targetMargin` on cost when selling at `sellPrice`, after
 * the AH cut, any deposit spent on sale and one lost deposit (a listing that expires once).
 * null when no buy price reaches the margin.
 */
export function maxBuyPrice(config: Config, input: MaxBuyInput): Copper | null {
  const qty = Math.max(1, Math.floor(input.qty));
  const dep = postingDeposit(config, input.mode, input.vendorSellEach, qty, input.durationKey, input.ahType);
  const costs = (saleCost(config, dep) + dep) / qty;
  const room = netOnSale(config, input.sellPrice, input.ahType) - costs;
  const max = Math.floor(room / (1 + Math.max(0, input.targetMargin)));
  return max > 0 ? max : null;
}

export interface WatchItem {
  itemId: number;
  favorite: boolean;
  /** Names of workflows that buy or sell this item on the AH. */
  workflows: string[];
  /** The ledger holds stock of it. */
  held: boolean;
}

/**
 * Items on the watchlist: favorites, every item a workflow buys on the AH or sells there, and every
 * item the ledger holds stock of. Stand-in "any item" IDs are left out: they are not real AH listings.
 */
export function watchlistItems(data: EngineData, workflows: Workflow[], saved: FlipFavorite[], held: Iterable<number> = []): WatchItem[] {
  const byId = new Map<number, WatchItem>();
  const get = (itemId: number) => {
    let w = byId.get(itemId);
    if (!w) byId.set(itemId, (w = { itemId, favorite: false, workflows: [], held: false }));
    return w;
  };
  for (const f of saved) if (isFavorite(f)) get(f.itemId).favorite = true;
  for (const id of held) get(id).held = true;
  for (const wf of workflows) {
    const recipes = wf.steps.map((s) => resolveStep(data, s)).filter((r) => r !== null);
    const inputs = new Set(recipes.flatMap((r) => r.inputs.map((i) => i.itemId)));
    const outputs = new Set(recipes.flatMap((r) => r.outputs.map((o) => o.itemId)));
    const ah = [
      ...[...inputs].filter((id) => !outputs.has(id) && buySourceFor(data, wf, id) === 'ah'),
      ...[...outputs].filter((id) => !inputs.has(id) && dispositionFor(data, wf, id) === 'ah'),
    ];
    for (const id of ah) {
      if (!data.items.has(id)) continue;
      const w = get(id);
      if (!w.workflows.includes(wf.name)) w.workflows.push(wf.name);
    }
  }
  return [...byId.values()];
}

/** Saved flip settings without the flag are favorites from before the watchlist. */
export const isFavorite = (f: FlipFavorite) => f.favorite !== false;

/** Settings a row uses: what was saved for the item, or the defaults. */
export function rowSettings(config: Config, itemId: number, saved: FlipFavorite | undefined): Required<Omit<FlipFavorite, 'favorite'>> & { favorite: boolean } {
  const defaultDuration = config.durations[1]?.key ?? config.durations[0]?.key ?? '';
  return {
    itemId,
    buyPrice: saved?.buyPrice ?? null,
    sellPrice: saved?.sellPrice ?? null,
    durationKey: saved && config.durations.some((d) => d.key === saved.durationKey) ? saved.durationKey : defaultDuration,
    ahType: saved?.ahType ?? 'faction',
    qty: Math.max(1, saved?.qty ?? 1),
    favorite: saved ? isFavorite(saved) : false,
  };
}

export interface WatchRow {
  /** Cheapest price seen last, the price you could buy at. */
  lastLow: Copper | null;
  lastLowAt: number | null;
  typical: Copper | null;
  n: number;
  /** Planned listing price: the saved sell price, else the typical price. */
  sellAt: Copper | null;
  sellAtIsTypical: boolean;
  buyBelow: Copper | null;
  /** Profit per item buying at the last low and selling at `sellAt`, if it sells first time. */
  margin: Copper | null;
  /** `margin` as a fraction of the buy price. */
  marginPct: number | null;
  /** Times the lot can expire before buying at the last low stops paying. null: expiring costs nothing. */
  relists: number | null;
}

export function watchRow(config: Config, item: Item | undefined, settings: ReturnType<typeof rowSettings>, stats: PriceStats, targetMargin: number): WatchRow {
  const sellAt = settings.sellPrice ?? stats.typical;
  const lastLow = stats.last?.price ?? null;
  const base = {
    vendorSellEach: item?.vendorSell ?? null,
    durationKey: settings.durationKey,
    ahType: settings.ahType,
    qty: settings.qty,
    mode: listingMode(config, item?.itemClass),
  };
  const buyBelow = sellAt === null ? null : maxBuyPrice(config, { ...base, sellPrice: sellAt, targetMargin });
  const r = sellAt !== null && lastLow !== null ? flip(config, { ...base, buyPrice: lastLow, sellPrice: sellAt }) : null;
  return {
    lastLow,
    lastLowAt: stats.last?.observedAt ?? null,
    typical: stats.typical,
    n: stats.n,
    sellAt,
    sellAtIsTypical: settings.sellPrice === null && sellAt !== null,
    buyBelow,
    margin: r?.profitFirstListing ?? null,
    marginPct: r && lastLow ? r.profitFirstListing / lastLow : null,
    relists: r ? r.failedListingsAbsorbed : null,
  };
}
