import { price, type PriceContext } from './prices';
import type { AhType, Copper, FavorCrate, Item, Qty } from './types';

/** What one bundle that fills a crate costs. `unitPrice` is null when an item has no price. */
export interface BundleCost extends Qty {
  unitPrice: Copper | null;
  /** 'vendor' when a vendor sells the item for less than the AH. */
  source: 'ah' | 'vendor' | null;
  cost: Copper | null;
}

export interface CrateCost {
  bundles: BundleCost[];
  /** The cheapest priced bundle; null when none is priced. */
  cheapest: BundleCost | null;
  /** What the crate itself costs: its AH price, or 0 when it is not counted. null when unknown. */
  crateCost: Copper | null;
  /** The crate should count but has no AH price (or no item yet): the total leaves it out. */
  crateMissing: boolean;
  /** Crate plus cheapest bundle. null when no bundle is priced. */
  total: Copper | null;
  /** Total divided by the favor the crate gives. null when either is unknown. */
  perFavor: Copper | null;
}

/** The cheaper of the AH and a vendor for buying an item. */
export function buyPrice(ctx: PriceContext, itemId: number, ahType: AhType): { price: Copper; source: 'ah' | 'vendor' } | null {
  const ah = price(ctx, itemId, 'ah', ahType);
  const vendor = price(ctx, itemId, 'vendor-buy');
  if (vendor !== null && (ah === null || vendor < ah)) return { price: vendor, source: 'vendor' };
  return ah === null ? null : { price: ah, source: 'ah' };
}

/**
 * What Merchant Favor costs through one crate: the crate plus the cheapest bundle
 * that fills it, divided by the favor it gives. With `countCrate` the crate costs its AH price even
 * if you found it, since you could sell it instead; without it the crate is free. A crate without
 * an AH price is left out of the total and flagged, so the bundles still compare.
 */
export function crateCost(ctx: PriceContext, crate: FavorCrate, ahType: AhType, countCrate: boolean): CrateCost {
  const bundles = crate.bundles.map((b): BundleCost => {
    const p = buyPrice(ctx, b.itemId, ahType);
    return { ...b, unitPrice: p?.price ?? null, source: p?.source ?? null, cost: p === null ? null : p.price * b.qty };
  });
  const cheapest = bundles.reduce<BundleCost | null>((best, b) => (b.cost !== null && (best === null || b.cost < best.cost!) ? b : best), null);
  const crateCost = !countCrate ? 0 : crate.itemId === null ? null : price(ctx, crate.itemId, 'ah', ahType);
  const total = cheapest === null ? null : (crateCost ?? 0) + cheapest.cost!;
  const perFavor = total === null || !crate.favor ? null : total / crate.favor;
  return { bundles, cheapest, crateCost, crateMissing: crateCost === null, total, perFavor };
}

/** Crate tiers in game order. */
export const CRATE_TIERS = ['Apprentice', 'Journeyman', 'Expert', 'Artisan'] as const;

/** Favor per tier where it is known. */
export const TIER_FAVOR: Partial<Record<(typeof CRATE_TIERS)[number], number>> = { Apprentice: 10, Journeyman: 20 };

export const isCrateName = (name: string) => /^Waylaid Crate\b/i.test(name.trim());

/** The tier a crate's name mentions, as an index into CRATE_TIERS; unknown sorts last. */
export function crateTier(name: string): number {
  const i = CRATE_TIERS.findIndex((t) => new RegExp(`\\b${t}\\b`, 'i').test(name));
  return i < 0 ? CRATE_TIERS.length : i;
}

/** Default favor for a crate from its tier; null when the tier's favor is not known. */
export const tierFavor = (name: string): number | null => TIER_FAVOR[CRATE_TIERS[crateTier(name)]] ?? null;

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Match bundle lines from a crate tooltip to catalog items by name, ignoring case. Lines whose
 * item is not in the catalog are returned as unmatched.
 */
export function matchBundles(lines: { qty: number; name: string }[], items: Iterable<Item>): { bundles: Qty[]; unmatched: { qty: number; name: string }[] } {
  const byName = new Map<string, number>();
  for (const i of items) if (!byName.has(norm(i.name))) byName.set(norm(i.name), i.id);
  const bundles: Qty[] = [];
  const unmatched: { qty: number; name: string }[] = [];
  for (const l of lines) {
    const id = byName.get(norm(l.name));
    if (id === undefined) unmatched.push(l);
    else bundles.push({ itemId: id, qty: l.qty });
  }
  return { bundles, unmatched };
}
