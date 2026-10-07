import { describe, expect, it } from 'vitest';
import { crateCost, crateTier, matchBundles, tierFavor } from './favor';
import { ahKey, type PriceContext } from './prices';
import type { AhPrice, FavorCrate, Item } from './types';

const ah = (itemId: number, price: number, ahType: AhPrice['ahType'] = 'faction'): [string, AhPrice] => [
  ahKey(itemId, ahType),
  { itemId, ahType, price, observedAt: 0, n: 1 },
];
const item = (id: number, vendorBuy: number | null): Item => ({
  id,
  name: `#${id}`,
  quality: 1,
  itemLevel: null,
  itemClass: 'other',
  subclass: null,
  vendorSell: null,
  icon: null,
  vendorBuy,
});

const crate: FavorCrate = {
  id: 1,
  name: 'Waylaid Crate: Journeyman Parts',
  itemId: 900,
  favor: 20,
  bundles: [
    { itemId: 4371, qty: 8 },
    { itemId: 4382, qty: 4 },
    { itemId: 10558, qty: 45 },
  ],
  notes: '',
};

describe('crateCost', () => {
  const ctx: PriceContext = {
    items: new Map([[10558, item(10558, 150)]]),
    // 8 tubes 4000, 4 frameworks 3200, 45 cores 9000 on the AH but 6750 from a vendor.
    ahPrices: new Map([ah(900, 1000), ah(4371, 500), ah(4382, 800), ah(10558, 200), ah(4382, 100, 'neutral')]),
    ahMins: new Map(),
  };

  it('adds the crate to the cheapest bundle and divides by favor', () => {
    const c = crateCost(ctx, crate, 'faction', true);
    expect(c.bundles.map((b) => [b.cost, b.source])).toEqual([
      [4000, 'ah'],
      [3200, 'ah'],
      [6750, 'vendor'],
    ]);
    expect(c.cheapest?.itemId).toBe(4382);
    expect(c.crateCost).toBe(1000);
    expect(c.total).toBe(4200);
    expect(c.perFavor).toBe(210);
  });

  it('counts a found crate as free when asked', () => {
    expect(crateCost(ctx, crate, 'faction', false).perFavor).toBe(160);
  });

  it('prices on the chosen AH and skips unpriced bundles', () => {
    const c = crateCost(ctx, crate, 'neutral', false);
    expect(c.bundles.map((b) => b.cost)).toEqual([null, 400, 6750]);
    expect(c.perFavor).toBe(20);
    // The crate has no neutral price: the total leaves it out and says so.
    expect(crateCost(ctx, crate, 'neutral', true)).toMatchObject({ crateCost: null, crateMissing: true, total: 400 });
    expect(crateCost(ctx, crate, 'faction', true).crateMissing).toBe(false);
  });

  it('has no per-favor cost while the favor is unknown', () => {
    const c = crateCost(ctx, { ...crate, favor: null }, 'faction', true);
    expect(c.total).toBe(4200);
    expect(c.perFavor).toBeNull();
  });
});

describe('crate names', () => {
  it('reads the tier and its favor', () => {
    expect(crateTier('Waylaid Crate: Apprentice Herbs')).toBe(0);
    expect(crateTier('Waylaid Crate: Flowering Artisan Herbs')).toBe(3);
    expect(crateTier('Something else')).toBe(4);
    expect(tierFavor('Waylaid Crate: Journeyman Ore')).toBe(20);
    expect(tierFavor('Waylaid Crate: Earthly Expert Herbs')).toBeNull();
  });

  it('matches bundle names to items ignoring case', () => {
    const items = [item(4371, null), item(4382, null)].map((i) => ({ ...i, name: i.id === 4371 ? 'Bronze Tube' : 'Bronze Framework' }));
    expect(matchBundles([{ qty: 8, name: 'bronze tube' }, { qty: 2, name: 'Nope' }], items)).toEqual({
      bundles: [{ itemId: 4371, qty: 8 }],
      unmatched: [{ qty: 2, name: 'Nope' }],
    });
  });
});
