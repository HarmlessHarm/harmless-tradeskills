import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, withDefaults } from '../config';
import { deShuffle, engineData, IDS, setAhPrice } from '../test/fixtures';
import { deposit, flip, listingMode, netOnSale, postingDeposit } from './ah';
import { price } from './prices';
import type { Config } from './types';
import { anyItem, anyItemId, deriveDisenchantRecipe, findDisenchantRule } from './disenchant';
import { formatMoney, parseMoney } from './money';
import { analyzeWorkflow, describeStep, insertBeforeConsumer, producersOf } from './workflow';

describe('money', () => {
  it('formats copper as g/s/c', () => {
    expect(formatMoney(0)).toBe('0c');
    expect(formatMoney(5)).toBe('5c');
    expect(formatMoney(205)).toBe('2s 5c');
    expect(formatMoney(10_203)).toBe('1g 2s 3c');
    expect(formatMoney(10_000)).toBe('1g');
    expect(formatMoney(10_003)).toBe('1g 3c');
    expect(formatMoney(400)).toBe('4s');
    expect(formatMoney(-150)).toBe('-1s 50c');
    expect(formatMoney(null)).toBe('-');
  });
  it('parses human input', () => {
    expect(parseMoney('1g 2s 3c')).toBe(10_203);
    expect(parseMoney('1g2s')).toBe(10_200);
    expect(parseMoney('25s')).toBe(2500);
    expect(parseMoney('42')).toBe(42);
    expect(parseMoney('-3s 5c')).toBe(-305);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('g')).toBeNull();
  });
});

describe('AH channel', () => {
  const cfg = DEFAULT_CONFIG;
  it('takes the cut on sale', () => {
    expect(netOnSale(cfg, 10_000, 'faction')).toBe(9_500);
    expect(netOnSale(cfg, 10_000, 'neutral')).toBe(8_500);
  });
  it('bases the deposit on vendor sell price and duration', () => {
    expect(deposit(cfg, 100, 5, '8h', 'faction')).toBe(75);
    expect(deposit(cfg, 0, 1, '8h', 'faction')).toBe(cfg.minDeposit);
  });
  it('matches a hand calculation for a flip', () => {
    // Buy 1g, sell 1g 50s, 8h faction, vendor sell 20s: cut 7s 50c, deposit 3s.
    const r = flip(cfg, { buyPrice: 10_000, sellPrice: 15_000, vendorSellEach: 2000, durationKey: '8h', ahType: 'faction' });
    expect(r.cut).toBe(750);
    expect(r.deposit).toBe(300);
    expect(r.profitFirstListing).toBe(4_250);
    expect(r.costPerFailedListing).toBe(300);
    expect(r.failedListingsAbsorbed).toBe(14);
    expect(r.breakEvenSellPrice).toBe(10_526);
    expect(netOnSale(cfg, r.breakEvenSellPrice, 'faction')).toBeGreaterThanOrEqual(10_000);
    expect(netOnSale(cfg, r.breakEvenSellPrice - 1, 'faction')).toBeLessThan(10_000);
  });
  it('flags a flip that loses money', () => {
    const r = flip(cfg, { buyPrice: 10_000, sellPrice: 10_000, vendorSellEach: 0, durationKey: '2h', ahType: 'faction' });
    expect(r.failedListingsAbsorbed).toBe(-1);
  });
  it('charges the minimum deposit per auction', () => {
    const r = flip(cfg, { buyPrice: 100, sellPrice: 200, vendorSellEach: 1, durationKey: '8h', ahType: 'faction' });
    expect(r.costPerFailedListing).toBe(cfg.minDeposit);
    const perItem = flip(cfg, { buyPrice: 100, sellPrice: 200, vendorSellEach: 1, durationKey: '8h', ahType: 'faction', qty: 10 });
    expect(perItem.costPerFailedListing).toBe(10 * cfg.minDeposit);
    const lot = flip(cfg, { buyPrice: 100, sellPrice: 200, vendorSellEach: 1, durationKey: '8h', ahType: 'faction', qty: 10, mode: 'lot' });
    expect(lot.costPerFailedListing).toBe(cfg.minDeposit);
  });
  it('posts a lot as one auction with one deposit', () => {
    // 20 items, vendor sell 20s, 8h faction: one deposit of 20 x 20s x 15% = 60s.
    const input = { buyPrice: 10_000, sellPrice: 15_000, vendorSellEach: 2000, durationKey: '8h', ahType: 'faction' as const, qty: 20 };
    const lot = flip(cfg, { ...input, mode: 'lot' });
    expect(lot.deposit).toBe(6_000);
    expect(lot.profitTotal).toBe(20 * 4_250);
    expect(lot.profitFirstListing).toBe(4_250);
    expect(lot.failedListingsAbsorbed).toBe(14);
    // Rounding: per piece floors each small deposit, a lot floors once.
    expect(postingDeposit(cfg, 'perItem', 7, 20, '8h', 'faction')).toBe(20 * 1);
    expect(postingDeposit(cfg, 'lot', 7, 20, '8h', 'faction')).toBe(21);
  });
  it('spends the deposit on sale when it is not refunded', () => {
    const noRefund = { ...cfg, depositRefundedOnSale: false };
    const r = flip(noRefund, { buyPrice: 10_000, sellPrice: 15_000, vendorSellEach: 2000, durationKey: '8h', ahType: 'faction', qty: 20, mode: 'lot' });
    expect(r.profitTotal).toBe(20 * 4_250 - 6_000);
    expect(r.profitFirstListing).toBe(4_250 - 300);
    // Break-even must also cover the 3s of deposit per item.
    expect(netOnSale(noRefund, r.breakEvenSellPrice, 'faction')).toBeGreaterThanOrEqual(10_300);
    expect(netOnSale(noRefund, r.breakEvenSellPrice - 1, 'faction')).toBeLessThan(10_300);
  });
  it('picks the listing mode by item class', () => {
    expect(listingMode(cfg, 'armor')).toBe('perItem');
    expect(listingMode(cfg, 'weapon')).toBe('perItem');
    expect(listingMode(cfg, 'other')).toBe('lot');
    expect(listingMode(cfg, undefined)).toBe('lot');
  });
  it('fills in listing modes missing from an older stored config', () => {
    expect(withDefaults({ listingMode: { armor: 'lot' } as Config['listingMode'] }).listingMode).toEqual({ armor: 'lot', weapon: 'perItem', other: 'lot' });
    expect(withDefaults({}).depositRefundedOnSale).toBe(true);
  });
});

describe('disenchant rules', () => {
  const data = engineData();
  it('matches on quality, level band and armor vs weapon', () => {
    const gloves = data.items.get(IDS.gloves)!;
    expect(findDisenchantRule(data.deRules, gloves)?.id).toBe(1);
    expect(findDisenchantRule(data.deRules, { ...gloves, itemLevel: 20 })).toBeNull();
    expect(findDisenchantRule(data.deRules, { ...gloves, itemClass: 'weapon' })).toBeNull();
    expect(findDisenchantRule(data.deRules, { ...gloves, quality: 3 })).toBeNull();
  });
  it('derives a recipe', () => {
    const r = deriveDisenchantRecipe(data.deRules, data.items.get(IDS.gloves)!, 3000)!;
    expect(r.inputs).toEqual([{ itemId: IDS.gloves, qty: 1 }]);
    expect(r.outputMode).toBe('exclusive');
    expect(r.outputs).toHaveLength(2);
  });
});

describe('workflow: DE shuffle', () => {
  const data = engineData();
  const a = analyzeWorkflow(data, deShuffle);

  it('solves runs per glove as in the PRD', () => {
    expect(a.errors).toEqual([]);
    expect(a.unitItemId).toBe(IDS.gloves);
    const runs = a.steps.map((s) => s.runsPerUnit);
    expect(runs[0]).toBeCloseTo(2); // bolts
    expect(runs[1]).toBeCloseTo(1); // gloves
    expect(runs[2]).toBeCloseTo(1); // DE
    expect(runs[3]).toBeCloseTo(1.2); // oils
    expect(runs[4]).toBeCloseTo(0.15); // wands
  });

  it('buys external inputs and sells terminal outputs', () => {
    const inputs = Object.fromEntries(a.externalInputs.map((x) => [x.itemId, x]));
    expect(inputs[IDS.linen].qtyPerUnit).toBeCloseTo(4);
    expect(inputs[IDS.linen].source).toBe('ah');
    expect(inputs[IDS.thread].source).toBe('vendor');
    expect(inputs[IDS.seed].qtyPerUnit).toBeCloseTo(1.2);
    expect(inputs[IDS.wood].qtyPerUnit).toBeCloseTo(0.15);
    expect(inputs[IDS.bolt]).toBeUndefined();

    const outs = Object.fromEntries(a.terminalOutputs.map((x) => [x.itemId, x]));
    expect(Object.keys(outs).map(Number).sort()).toEqual([IDS.oil, IDS.wand].sort());
    expect(outs[IDS.oil].qtyPerUnit).toBeCloseTo(1.2);
    expect(outs[IDS.wand].disposition).toBe('vendor');
    expect(a.tools).toEqual([IDS.rod]);
  });

  it('computes EV profit per glove', () => {
    const cost = 4 * 15 + 10 + 1.2 * (90 + 4) + 0.15 * 38;
    const revenue = 1.2 * 400 + 0.15 * 1100;
    expect(a.costPerUnit).toBeCloseTo(cost);
    expect(a.revenuePerUnit).toBeCloseTo(revenue);
    expect(a.profitPerUnit).toBeCloseTo(revenue - cost);
  });

  it('computes time and gold per hour', () => {
    const perUnit = 2 * 1 + 5.125 + 3 + 1.2 * 5 + 0.15 * 10;
    expect(a.timePerUnitSec).toBeCloseTo(perUnit);
    expect(a.batchTimeSec).toBeCloseTo(20 * perUnit + 60);
    expect(a.goldPerHourCopper).toBeCloseTo((a.profitPerUnit * 20 * 3600) / (20 * perUnit + 60));
  });

  it('computes the gold needed to buy a batch', () => {
    // 80 linen, 20 thread, 24 seeds, 24 vials, 3 wood; oil and wand go to a vendor, so no deposits.
    expect(a.batchInvestment).toBe(80 * 15 + 20 * 10 + 24 * 90 + 24 * 4 + 3 * 38);
    expect(a.batchDeposits).toBe(0);
    const d = engineData();
    setAhPrice(d, IDS.oil, 1000);
    const r = analyzeWorkflow(d, { ...deShuffle, sellMap: { [IDS.oil]: 'ah' } });
    // Oil is not gear, so the 24 oils go up as one lot with one deposit.
    expect(r.batchDeposits).toBe(deposit(d.config, 400, 24, '8h', 'faction'));
    d.config = { ...d.config, listingMode: { ...d.config.listingMode, other: 'perItem' } };
    const perItem = analyzeWorkflow(d, { ...deShuffle, sellMap: { [IDS.oil]: 'ah' } });
    expect(perItem.batchDeposits).toBe(24 * deposit(d.config, 400, 1, '8h', 'faction'));
  });

  it('simulates a batch of 20 with an ordered percentile range', () => {
    const sim = a.simulation!;
    expect(sim.batchSize).toBe(20);
    expect(sim.p5).toBeLessThanOrEqual(sim.p50);
    expect(sim.p50).toBeLessThanOrEqual(sim.p95);
    expect(sim.p5).toBeLessThan(sim.p95);
    // Leftover essence (odd counts cannot all become wands) makes the sim slightly below EV.
    expect(sim.mean).toBeLessThanOrEqual(a.batchProfit + 1);
    expect(sim.mean).toBeGreaterThan(a.batchProfit - 0.15 * 20 * 1100);
    expect(sim.leftovers.some((l) => l.itemId === IDS.lme)).toBe(true);
    expect(sim.worstCase).toBe(sim.p5); // no min AH prices set
    expect(sim.deterministic).toBe(false);
  });

  it('is deterministic for a seed', () => {
    expect(analyzeWorkflow(data, deShuffle).simulation).toEqual(a.simulation);
  });

  it('falls back to the AH price for the worst case, and prices by AH type', () => {
    const d = engineData();
    expect(price(d, IDS.linen, 'ah-min')).toBe(15);
    d.ahMins.set(IDS.linen, 10);
    expect(price(d, IDS.linen, 'ah-min')).toBe(10);
    expect(price(d, IDS.linen, 'ah', 'neutral')).toBeNull();
    // The min AH price is yours, not per AH: it applies to a neutral price too.
    setAhPrice(d, IDS.linen, 25, null, 'neutral');
    expect(price(d, IDS.linen, 'ah-min', 'neutral')).toBe(10);
  });

  it('uses min AH prices for the worst case', () => {
    const d = engineData();
    setAhPrice(d, IDS.oil, 1000, 500);
    const r = analyzeWorkflow(d, { ...deShuffle, sellMap: { [IDS.oil]: 'ah' } });
    expect(r.simulation!.worstCase).toBeLessThan(r.simulation!.p5);
  });

  it('prices each workflow on its own AH', () => {
    const d = engineData();
    setAhPrice(d, IDS.linen, 25, null, 'neutral');
    // The faction price (15c) is unchanged; a neutral workflow uses the neutral one.
    expect(analyzeWorkflow(d, deShuffle).profitPerUnit).toBeCloseTo(a.profitPerUnit);
    const neutral = analyzeWorkflow(d, { ...deShuffle, ahType: 'neutral' });
    expect(neutral.externalInputs.find((x) => x.itemId === IDS.linen)!.unitPrice).toBe(25);
  });

  it('updates immediately when a price changes', () => {
    const d = engineData();
    setAhPrice(d, IDS.linen, 25);
    expect(analyzeWorkflow(d, deShuffle).profitPerUnit).toBeCloseTo(a.profitPerUnit - 40);
  });

  it('respects a chosen unit item', () => {
    const r = analyzeWorkflow(data, { ...deShuffle, unitItemId: IDS.bolt });
    expect(r.steps[0].runsPerUnit).toBeCloseTo(1);
    expect(r.steps[1].runsPerUnit).toBeCloseTo(0.5);
  });

  it('accepts a bought base item as the unit', () => {
    const r = analyzeWorkflow(data, { ...deShuffle, unitItemId: IDS.linen });
    expect(r.errors).toEqual([]);
    expect(r.steps[0].runsPerUnit).toBeCloseTo(0.5);
    expect(r.steps[1].runsPerUnit).toBeCloseTo(0.25);
    expect(r.externalInputs.find((x) => x.itemId === IDS.linen)!.qtyPerUnit).toBeCloseTo(1);
  });

  it('reports missing prices', () => {
    const d = engineData({ ahPrices: new Map() });
    const r = analyzeWorkflow(d, deShuffle);
    expect(r.missingPrices).toContainEqual({ itemId: IDS.linen, what: 'ah price' });
  });

  it('reports a step that is not connected', () => {
    const r = analyzeWorkflow(data, {
      ...deShuffle,
      steps: [{ type: 'recipe', recipeId: 'spell:2963' }, { type: 'recipe', recipeId: 'spell:25124' }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Not connected/);
  });

  it('reports a missing disenchant rule', () => {
    const r = analyzeWorkflow(engineData({ deRules: [] }), deShuffle);
    expect(r.errors[0]).toMatch(/no disenchant rule/);
  });
});

describe('workflow: no chance-based outputs', () => {
  const data = engineData();
  const wf = { ...deShuffle, steps: deShuffle.steps.slice(0, 2), unitItemId: IDS.gloves };
  const a = analyzeWorkflow(data, wf);

  it('replaces the simulation with one exact batch', () => {
    const sim = a.simulation!;
    expect(sim.deterministic).toBe(true);
    expect(sim.runs).toBe(1);
    expect(sim.p5).toBe(sim.p95);
    expect(sim.p50).toBeCloseTo(a.batchProfit);
  });
});

describe('workflow: adding a step for a bought input', () => {
  const data = engineData();
  const bolt = { type: 'recipe', recipeId: 'spell:2963' } as const;

  it('finds the recipes that make an item', () => {
    expect(producersOf(data, IDS.bolt).map((r) => r.id)).toEqual(['spell:2963']);
    expect(producersOf(data, IDS.linen)).toEqual([]);
  });

  it('inserts the step before the first step that uses the item', () => {
    const steps = deShuffle.steps.slice(1);
    const next = insertBeforeConsumer(data, steps, IDS.bolt, bolt);
    expect(next).toEqual([bolt, ...steps]);
    const wf = { ...deShuffle, steps: next };
    expect(analyzeWorkflow(data, wf).externalInputs.map((x) => x.itemId)).toContain(IDS.linen);
  });

  it('inserts mid-list when the consumer is not the first step', () => {
    const steps = [deShuffle.steps[0], deShuffle.steps[4]];
    const wood = { type: 'recipe', recipeId: 'local:wood' } as const;
    expect(insertBeforeConsumer(data, steps, IDS.wood, wood)).toEqual([steps[0], wood, steps[1]]);
  });

  it('falls back to the top when no step uses the item', () => {
    expect(insertBeforeConsumer(data, deShuffle.steps.slice(3), IDS.bolt, bolt)[0]).toEqual(bolt);
  });
});

describe('workflow: buy limit for any uncommon armor', () => {
  const data = engineData();
  const armor = anyItemId(2, 'armor', 10);
  const anyStep = { type: 'disenchant-any' as const, quality: 2 as const, itemClass: 'armor' as const, itemLevel: 10 };
  const wf = {
    ...deShuffle,
    steps: [
      anyStep,
      { type: 'recipe' as const, recipeId: 'spell:25124' },
      { type: 'recipe' as const, recipeId: 'spell:14807' },
    ],
  };
  const a = analyzeWorkflow(data, wf);
  const cost = 1.2 * (90 + 4) + 0.15 * 38;
  const revenue = 1.2 * 400 + 0.15 * 1100;

  it('names the stand-in item after the matching rule band', () => {
    expect(anyItem(data.deRules, armor)).toMatchObject({ quality: 2, itemClass: 'armor', itemLevel: 10, name: 'Any uncommon armor, ilvl 5-15' });
    expect(anyItem(data.deRules, anyItemId(3, 'weapon', 40))?.name).toBe('Any rare weapon, ilvl 40');
    expect(describeStep(data, anyStep)).toBe('Disenchant any uncommon armor, ilvl 5-15');
  });

  it('solves per bought item and leaves its cost out', () => {
    expect(a.errors).toEqual([]);
    expect(a.unitItemId).toBe(armor);
    expect(a.steps.map((s) => s.runsPerUnit)).toEqual([1, expect.closeTo(1.2), expect.closeTo(0.15)]);
    expect(a.externalInputs.some((x) => x.itemId === armor)).toBe(false);
    expect(a.missingPrices).toEqual([]);
    expect(a.profitPerUnit).toBeCloseTo(revenue - cost);
  });

  it('gives the break-even and worst case buy prices', () => {
    const limit = a.buyLimit!;
    expect(limit.itemId).toBe(armor);
    expect(limit.breakEven).toBe(Math.floor(revenue - cost));
    expect(limit.forTarget).toBeNull();
    const sim = a.simulation!;
    expect(limit.worstCase).toBe(Math.floor(sim.worstCase / 20));
    expect(limit.worstCase!).toBeLessThan(limit.breakEven);
  });

  it('gives the buy price that still earns a target gold per hour', () => {
    const target = 5 * 10_000;
    const r = analyzeWorkflow(data, { ...wf, targetGoldPerHour: target });
    const price = r.buyLimit!.forTarget!;
    const gph = (p: number) => ((r.batchProfit - 20 * p) * 3600) / r.batchTimeSec;
    expect(gph(price)).toBeGreaterThanOrEqual(target);
    expect(gph(price + 1)).toBeLessThan(target);
    expect(analyzeWorkflow(data, { ...wf, targetGoldPerHour: 0 }).buyLimit!.forTarget).toBe(a.buyLimit!.breakEven);
  });

  it('has no buy limit for a normal workflow', () => {
    expect(analyzeWorkflow(data, deShuffle).buyLimit).toBeNull();
  });

  it('reports a band without a disenchant rule', () => {
    const r = analyzeWorkflow(data, { ...wf, steps: [{ ...anyStep, itemLevel: 30 }, ...wf.steps.slice(1)] });
    expect(r.errors[0]).toMatch(/no disenchant rule matches any uncommon armor, ilvl 30/);
  });
});
