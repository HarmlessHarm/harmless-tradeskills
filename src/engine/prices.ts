import type { Copper, Item, PriceObservation } from './types';

export type PriceChannel = 'ah' | 'ah-min' | 'vendor-buy' | 'vendor-sell';

export interface PriceContext {
  items: Map<number, Item>;
  prices: Map<number, PriceObservation>;
}

/**
 * The single entry point for every price lookup (REQ-4.3, DEC-8).
 * Stored vendor prices are base prices; modifiers such as reputation discounts belong here later.
 * Returns null when the price is unknown.
 */
export function price(ctx: PriceContext, itemId: number, channel: PriceChannel): Copper | null {
  switch (channel) {
    case 'ah':
      return ctx.prices.get(itemId)?.ahPrice ?? null;
    case 'ah-min': {
      const obs = ctx.prices.get(itemId);
      return obs?.ahMin ?? obs?.ahPrice ?? null;
    }
    case 'vendor-buy':
      return ctx.items.get(itemId)?.vendorBuy ?? null;
    case 'vendor-sell':
      return ctx.items.get(itemId)?.vendorSell ?? null;
  }
}
