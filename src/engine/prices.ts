import type { AhPrice, AhType, Copper, Item } from './types';

export type PriceChannel = 'ah' | 'ah-min' | 'vendor-buy' | 'vendor-sell';

export interface PriceContext {
  items: Map<number, Item>;
  /** Current AH price per item and AH type, keyed by `ahKey` (DEC-27). */
  ahPrices: Map<string, AhPrice>;
  /** Min AH price per item: a worst-case assumption you set, not an observation (REQ-4.2). */
  ahMins: Map<number, Copper>;
}

export const ahKey = (itemId: number, ahType: AhType) => `${itemId}:${ahType}`;

/**
 * The single entry point for every price lookup (REQ-4.3, DEC-8).
 * Stored vendor prices are base prices; modifiers such as reputation discounts belong here later.
 * AH prices are per AH type. Returns null when the price is unknown.
 */
export function price(ctx: PriceContext, itemId: number, channel: PriceChannel, ahType: AhType = 'faction'): Copper | null {
  switch (channel) {
    case 'ah':
      return ctx.ahPrices.get(ahKey(itemId, ahType))?.price ?? null;
    case 'ah-min':
      return ctx.ahMins.get(itemId) ?? price(ctx, itemId, 'ah', ahType);
    case 'vendor-buy':
      return ctx.items.get(itemId)?.vendorBuy ?? null;
    case 'vendor-sell':
      return ctx.items.get(itemId)?.vendorSell ?? null;
  }
}
