import type { AhType, Config, Copper } from './types';

/** The AH sell channel (REQ-5, DEC-13), shared by workflows and the flip calculator. */

export function durationRate(config: Config, durationKey: string, ahType: AhType): number {
  const d = config.durations.find((x) => x.key === durationKey) ?? config.durations[0];
  return d ? d.depositRate[ahType] : 0;
}

/** Deposit for one listing. Based on the vendor sell price of the listed stack. */
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

/** What you receive when a listing sells. The deposit is refunded on sale (REQ-5.2), so it cancels out. */
export function netOnSale(config: Config, salePrice: Copper, ahType: AhType): Copper {
  return salePrice - Math.floor(salePrice * config.ahCut[ahType]);
}

export interface FlipInput {
  buyPrice: Copper;
  sellPrice: Copper;
  qty: number;
  vendorSellEach: Copper | null;
  durationKey: string;
  ahType: AhType;
}

export interface FlipResult {
  cut: Copper;
  deposit: Copper;
  /** Profit if it sells on the first listing. */
  profitFirstListing: Copper;
  /** Deposit lost per expired listing (REQ-5.2). */
  costPerFailedListing: Copper;
  /**
   * How many listings can expire before the flip stops being profitable.
   * null when a failed listing costs nothing. Negative profit gives -1 (never profitable).
   */
  failedListingsAbsorbed: number | null;
  /** Minimum sell price (whole stack) that breaks even on the first listing. */
  breakEvenSellPrice: Copper;
}

/** Prices are for the whole listing (stack). */
export function flip(config: Config, input: FlipInput): FlipResult {
  const cut = Math.floor(input.sellPrice * config.ahCut[input.ahType]);
  const dep = deposit(config, input.vendorSellEach, input.qty, input.durationKey, input.ahType);
  const profitFirstListing = input.sellPrice - cut - input.buyPrice;
  let failedListingsAbsorbed: number | null;
  if (profitFirstListing < 0) failedListingsAbsorbed = -1;
  else if (dep === 0) failedListingsAbsorbed = null;
  else failedListingsAbsorbed = Math.floor(profitFirstListing / dep);
  const rate = config.ahCut[input.ahType];
  // Start from the exact answer, then correct for the cut being rounded down to whole copper.
  const net = (p: number) => p - Math.floor(p * rate);
  let breakEvenSellPrice = rate >= 1 ? Infinity : Math.ceil(input.buyPrice / (1 - rate));
  if (Number.isFinite(breakEvenSellPrice)) {
    while (net(breakEvenSellPrice) < input.buyPrice) breakEvenSellPrice++;
    while (breakEvenSellPrice > 0 && net(breakEvenSellPrice - 1) >= input.buyPrice) breakEvenSellPrice--;
  }
  return {
    cut,
    deposit: dep,
    profitFirstListing,
    costPerFailedListing: dep,
    failedListingsAbsorbed,
    breakEvenSellPrice,
  };
}
