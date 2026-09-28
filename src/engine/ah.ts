import type { AhType, Config, Copper, ItemClass, ListingMode } from './types';

/**
 * The AH sell channel (REQ-5, DEC-13, DEC-22), shared by workflows and the flip calculator.
 * Every rule that might differ in WoW Forever is a config value (NFR-5), not code:
 * cut, deposit rates, minimum deposit, whether the deposit comes back on sale, and whether an item
 * class is posted as one auction for the whole lot or as one auction per piece.
 */

export function durationRate(config: Config, durationKey: string, ahType: AhType): number {
  const d = config.durations.find((x) => x.key === durationKey) ?? config.durations[0];
  return d ? d.depositRate[ahType] : 0;
}

/** How an item class is posted. Unknown items count as 'other'. */
export function listingMode(config: Config, itemClass: ItemClass | null | undefined): ListingMode {
  return config.listingMode[itemClass ?? 'other'];
}

/** Deposit for one auction of `qty` items. Based on the vendor sell price of what is posted. */
export function deposit(
  config: Config,
  vendorSellEach: Copper | null,
  qty: number,
  durationKey: string,
  ahType: AhType,
): Copper {
  const base = Math.floor((vendorSellEach ?? 0) * qty * durationRate(config, durationKey, ahType));
  return Math.max(config.minDeposit, base);
}

/**
 * Deposit for posting `qty` items. A lot is one auction with one deposit (and one minimum deposit);
 * per piece is `qty` auctions of one, each with its own deposit.
 */
export function postingDeposit(
  config: Config,
  mode: ListingMode,
  vendorSellEach: Copper | null,
  qty: number,
  durationKey: string,
  ahType: AhType,
): Copper {
  if (qty <= 0) return 0;
  if (mode === 'lot') return deposit(config, vendorSellEach, qty, durationKey, ahType);
  return qty * deposit(config, vendorSellEach, 1, durationKey, ahType);
}

/** The AH cut on one sale. */
export function cutOnSale(config: Config, salePrice: Copper, ahType: AhType): Copper {
  return Math.floor(salePrice * config.ahCut[ahType]);
}

/**
 * What you receive when a sale goes through, before any deposit. If the deposit is refunded on sale
 * (REQ-5.2) it cancels out; otherwise callers add it as a cost, see `saleCost`.
 */
export function netOnSale(config: Config, salePrice: Copper, ahType: AhType): Copper {
  return salePrice - cutOnSale(config, salePrice, ahType);
}

/** Deposit that is spent even when the listing sells: zero when the AH refunds it on sale. */
export function saleCost(config: Config, depositPaid: Copper): Copper {
  return config.depositRefundedOnSale ? 0 : depositPaid;
}

export interface FlipInput {
  /** Price per item. */
  buyPrice: Copper;
  /** Price per item. */
  sellPrice: Copper;
  vendorSellEach: Copper | null;
  durationKey: string;
  ahType: AhType;
  /** Number of items flipped. Defaults to 1. */
  qty?: number;
  /** How the items are posted. Defaults to per piece. */
  mode?: ListingMode;
}

export interface FlipResult {
  qty: number;
  mode: ListingMode;
  /** AH cut per item. */
  cut: Copper;
  /** Deposit for posting the whole quantity once. */
  deposit: Copper;
  /** Profit per item if everything sells on the first listing (a non-refunded deposit is spread over the items). */
  profitFirstListing: Copper;
  /** Profit on the whole quantity if everything sells on the first listing. */
  profitTotal: Copper;
  /** Deposit lost when the whole quantity expires once and has to be relisted (REQ-5.2). */
  costPerFailedListing: Copper;
  /**
   * How many times the whole quantity can expire before the flip stops being profitable.
   * null when a failed listing costs nothing. Negative profit gives -1 (never profitable).
   */
  failedListingsAbsorbed: number | null;
  /** Minimum sell price per item that breaks even on the first listing. */
  breakEvenSellPrice: Copper;
}

/** Flip `qty` items bought and relisted on the same AH. Prices are per item. */
export function flip(config: Config, input: FlipInput): FlipResult {
  const qty = Math.max(1, Math.floor(input.qty ?? 1));
  const mode = input.mode ?? 'perItem';
  const cut = cutOnSale(config, input.sellPrice, input.ahType);
  const dep = postingDeposit(config, mode, input.vendorSellEach, qty, input.durationKey, input.ahType);
  const spentOnSale = saleCost(config, dep);
  const profitTotal = (input.sellPrice - cut - input.buyPrice) * qty - spentOnSale;
  const profitFirstListing = Math.floor(profitTotal / qty);
  let failedListingsAbsorbed: number | null;
  if (profitTotal < 0) failedListingsAbsorbed = -1;
  else if (dep === 0) failedListingsAbsorbed = null;
  else failedListingsAbsorbed = Math.floor(profitTotal / dep);

  // Net per item needed to cover the buy price plus any deposit that is spent on sale.
  const target = input.buyPrice + Math.ceil(spentOnSale / qty);
  const rate = config.ahCut[input.ahType];
  const net = (p: number) => netOnSale(config, p, input.ahType);
  // Start from the exact answer, then correct for the cut being rounded down to whole copper.
  let breakEvenSellPrice = rate >= 1 ? Infinity : Math.ceil(target / (1 - rate));
  if (Number.isFinite(breakEvenSellPrice)) {
    while (net(breakEvenSellPrice) < target) breakEvenSellPrice++;
    while (breakEvenSellPrice > 0 && net(breakEvenSellPrice - 1) >= target) breakEvenSellPrice--;
  }
  return {
    qty,
    mode,
    cut,
    deposit: dep,
    profitFirstListing,
    profitTotal,
    costPerFailedListing: dep,
    failedListingsAbsorbed,
    breakEvenSellPrice,
  };
}
