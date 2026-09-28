import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { deShuffle, engineData, IDS } from '../test/fixtures';
import { deposit, flip, netOnSale } from './ah';
import { deriveDisenchantRecipe, findDisenchantRule } from './disenchant';
import { formatMoney, parseMoney } from './money';
import { analyzeWorkflow } from './workflow';

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
    const r = flip(cfg, { buyPrice: 10_000, sellPrice: 15_000, qty: 1, vendorSellEach: 2000, durationKey: '8h', ahType: 'faction' });
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
    const r = flip(cfg, { buyPrice: 10_000, sellPrice: 10_000, qty: 1, vendorSellEach: 0, durationKey: '2h', ahType: 'faction' });
    expect(r.failedListingsAbsorbed).toBe(-1);
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
    expect(sim.worstCase).toBe(sim.p5); // no pessimistic prices set
    expect(sim.deterministic).toBe(false);
  });

  it('is deterministic for a seed', () => {
    expect(analyzeWorkflow(data, deShuffle).simulation).toEqual(a.simulation);
  });

  it('uses pessimistic AH prices for the worst case', () => {
    const d = engineData();
    d.prices.set(IDS.oil, { itemId: IDS.oil, ahPrice: 1000, ahPessimistic: 500, observedAt: 0 });
    const r = analyzeWorkflow(d, { ...deShuffle, sellMap: { [IDS.oil]: 'ah' } });
    expect(r.simulation!.worstCase).toBeLessThan(r.simulation!.p5);
  });

  it('updates immediately when a price changes', () => {
    const d = engineData();
    d.prices.set(IDS.linen, { itemId: IDS.linen, ahPrice: 25, ahPessimistic: null, observedAt: 1 });
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
    const d = engineData({ prices: new Map() });
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
