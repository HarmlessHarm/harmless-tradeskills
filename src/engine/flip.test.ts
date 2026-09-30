import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { deShuffle, engineData, IDS } from '../test/fixtures';
import { flip } from './ah';
import { maxBuyPrice, priceFloor, rowSettings, watchlistItems, watchRow } from './flip';
import type { PriceStats } from './snapshots';

const cfg = DEFAULT_CONFIG;
const base = { vendorSellEach: 2000, durationKey: '8h', ahType: 'faction' as const, qty: 1, mode: 'lot' as const };

describe('buy below', () => {
  it('leaves the target margin after the cut and one lost deposit', () => {
    // Sell 1g 50s: 1g 42s 50c after the 5% cut. One lost 3s deposit leaves 1g 39s 50c, / 1.15.
    const max = maxBuyPrice(cfg, { ...base, sellPrice: 15_000, targetMargin: 0.15 })!;
    expect(max).toBe(Math.floor(13_950 / 1.15));
    const r = flip(cfg, { ...base, buyPrice: max, sellPrice: 15_000 });
    expect(r.profitFirstListing - r.deposit).toBeGreaterThanOrEqual(0.15 * max);
    const over = flip(cfg, { ...base, buyPrice: max + 1, sellPrice: 15_000 });
    expect(over.profitFirstListing - over.deposit).toBeLessThan(0.15 * (max + 1));
  });

  it('spreads a lot deposit over the lot', () => {
    const one = maxBuyPrice(cfg, { ...base, sellPrice: 15_000, targetMargin: 0 })!;
    const lot = maxBuyPrice(cfg, { ...base, qty: 20, sellPrice: 15_000, targetMargin: 0 })!;
    // A lot of 20 pays 20 x the deposit of one, spread over 20: the same per item.
    expect(lot).toBe(one);
    // With a 1s minimum deposit: a lot pays one minimum (5c per item), per piece pays 20 (1s each).
    const minDep = { ...cfg, minDeposit: 100 };
    const cheap = { ...base, vendorSellEach: 1, sellPrice: 1_000, targetMargin: 0 };
    expect(maxBuyPrice(minDep, { ...cheap, qty: 20, mode: 'lot' })).toBe(950 - 5);
    expect(maxBuyPrice(minDep, { ...cheap, qty: 20, mode: 'perItem' })).toBe(950 - 100);
  });

  it('counts a deposit that is not refunded twice: spent on sale, and lost on expiry', () => {
    const kept = maxBuyPrice({ ...cfg, depositRefundedOnSale: false }, { ...base, sellPrice: 15_000, targetMargin: 0 });
    expect(kept).toBe(14_250 - 600);
  });

  it('has no answer when the deposit eats the whole sale', () => {
    expect(maxBuyPrice(cfg, { ...base, sellPrice: 100, targetMargin: 0.15 })).toBeNull();
  });
});

describe('watchlist items', () => {
  const data = engineData();

  it('lists favorites and items workflows trade on the AH', () => {
    // The DE shuffle buys linen on the AH (no vendor price); everything else is vendor or made in the chain.
    const list = watchlistItems(data, [deShuffle], [{ itemId: IDS.wand, buyPrice: null, sellPrice: null, durationKey: '8h', ahType: 'faction' }]);
    expect(list).toEqual([
      { itemId: IDS.wand, favorite: true, workflows: [], held: false },
      { itemId: IDS.linen, favorite: false, workflows: ['DE shuffle'], held: false },
    ]);
  });

  it('adds outputs sold on the AH and merges workflows', () => {
    const selling = { ...deShuffle, id: 2, name: 'Oil for AH', sellMap: { [IDS.oil]: 'ah' as const } };
    const list = watchlistItems(data, [deShuffle, selling], []);
    expect(list.find((w) => w.itemId === IDS.linen)?.workflows).toEqual(['DE shuffle', 'Oil for AH']);
    expect(list.find((w) => w.itemId === IDS.oil)?.workflows).toEqual(['Oil for AH']);
  });

  it('lists items the ledger holds, even when nothing else puts them there', () => {
    expect(watchlistItems(data, [], [], [IDS.oil])).toEqual([{ itemId: IDS.oil, favorite: false, workflows: [], held: true }]);
    expect(watchlistItems(data, [deShuffle], [], [IDS.linen])).toEqual([{ itemId: IDS.linen, favorite: false, workflows: ['DE shuffle'], held: true }]);
  });

  it('keeps remembered settings of workflow items without making them favorites', () => {
    const saved = [{ itemId: IDS.linen, buyPrice: 12, sellPrice: null, durationKey: '8h', ahType: 'faction' as const, favorite: false }];
    expect(watchlistItems(data, [deShuffle], saved)).toEqual([{ itemId: IDS.linen, favorite: false, workflows: ['DE shuffle'], held: false }]);
    // A remembered non-favorite that no workflow uses any more drops off.
    expect(watchlistItems(data, [], saved)).toEqual([]);
  });
});

describe('watchlist row', () => {
  const stats: PriceStats = { n: 6, nSolid: 6, last: { price: 10_000, qty: 20, observedAt: 5 }, min: 9_000, typical: 15_000 };
  const item = { ...engineData().items.get(IDS.oil)!, vendorSell: 2000 };

  it('defaults to selling at the typical price and buying at the last low', () => {
    const settings = rowSettings(cfg, IDS.oil, undefined);
    const row = watchRow(cfg, item, settings, stats, 0.15);
    expect(row.sellAt).toBe(15_000);
    expect(row.sellAtIsTypical).toBe(true);
    expect(row.buyBelow).toBe(maxBuyPrice(cfg, { ...base, sellPrice: 15_000, targetMargin: 0.15 }));
    // Buy 1g, sell 1g 50s: 4250 profit per item, 14 relists of a 3s deposit.
    expect(row.margin).toBe(4_250);
    expect(row.marginPct).toBeCloseTo(0.425);
    expect(row.relists).toBe(14);
  });

  it('uses the saved sell price and settings', () => {
    const settings = rowSettings(cfg, IDS.oil, { itemId: IDS.oil, buyPrice: null, sellPrice: 12_000, durationKey: 'nope', ahType: 'neutral', qty: 3 });
    expect(settings.durationKey).toBe('8h');
    expect(settings.favorite).toBe(true);
    const row = watchRow(cfg, item, settings, stats, 0.15);
    expect(row.sellAt).toBe(12_000);
    expect(row.sellAtIsTypical).toBe(false);
  });

  it('is empty without prices', () => {
    const row = watchRow(cfg, item, rowSettings(cfg, IDS.oil, undefined), { n: 0, nSolid: 0, last: null, min: null, typical: null }, 0.15);
    expect([row.lastLow, row.sellAt, row.buyBelow, row.margin, row.relists]).toEqual([null, null, null, null, null]);
  });
});

describe('price floor', () => {
  const posting = { vendorSellEach: 2000, durationKey: '8h', ahType: 'faction' as const, mode: 'lot' as const };

  it('is the average cost after the cut plus one lost deposit, spread over the stock', () => {
    // 20 held @ 1g. One auction of 20 costs a 60s deposit: 3s per item. 1g 8s 42c minus its 5s 42c cut is exactly 1g 3s.
    const floor = priceFloor(cfg, { ...posting, holdings: 20, avgCost: 10_000 })!;
    expect(floor).toBe(10_842);
    expect(flip(cfg, { ...posting, buyPrice: 10_000, sellPrice: floor, qty: 20 }).profitTotal).toBeGreaterThanOrEqual(6_000);
    expect(flip(cfg, { ...posting, buyPrice: 10_000, sellPrice: floor - 1, qty: 20 }).profitTotal).toBeLessThan(6_000);
  });

  it('has no floor without stock', () => {
    expect(priceFloor(cfg, { ...posting, holdings: 0, avgCost: null })).toBeNull();
  });

  it('flags a planned sell price under the floor', () => {
    const item = { ...engineData().items.get(IDS.oil)!, vendorSell: 2000 };
    const stats: PriceStats = { n: 6, nSolid: 6, last: { price: 9_000, qty: 5, observedAt: 1 }, min: 9_000, typical: 10_500 };
    const settings = rowSettings(cfg, IDS.oil, undefined);
    const row = watchRow(cfg, item, settings, stats, 0.15, { holdings: 20, avgCost: 10_000 });
    expect(row.floor).toBe(priceFloor(cfg, { ...posting, holdings: 20, avgCost: 10_000 }));
    expect(row.belowFloor).toBe(true);
    expect(watchRow(cfg, item, settings, { ...stats, typical: 12_000 }, 0.15, { holdings: 20, avgCost: 10_000 }).belowFloor).toBe(false);
    expect(watchRow(cfg, item, settings, stats, 0.15).floor).toBeNull();
  });
});
