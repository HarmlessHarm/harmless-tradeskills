import { describe, expect, it } from 'vitest';
import { realizedSince, replay, type Transaction, unrealized } from './ledger';

let seq = 0;
const tx = (kind: Transaction['kind'], qty: number, unitPrice: number | null, fee = 0): Transaction => {
  seq++;
  return { id: seq, uid: `t${seq}`, itemId: 2589, kind, qty, unitPrice, fee, ahType: 'faction', occurredAt: seq, source: 'manual', note: '' };
};

describe('ledger', () => {
  // The example from #19: 10 @ 5s + 20 @ 6s, then sell 15.
  const buys = () => [tx('buy', 10, 500), tx('buy', 20, 600)];

  it('averages buys: 10 @ 5s + 20 @ 6s gives 30 @ 5s 67c', () => {
    const s = replay(buys(), 'average');
    expect(s.holdings).toBe(30);
    expect(s.avgCost).toBe(567);
    expect(s.costRemaining).toBe(17_000);
  });

  it('selling 15: average cost 85s leaves 15 @ 5s 67c', () => {
    const s = replay([...buys(), tx('sell', 15, 800)], 'average');
    expect(s.sales[0].cost).toBe(8_500);
    expect(s.holdings).toBe(15);
    expect(s.avgCost).toBe(567);
    expect(s.realized).toBe(15 * 800 - 8_500);
  });

  it('selling 15: FIFO cost 80s leaves 15 @ 6s', () => {
    const s = replay([...buys(), tx('sell', 15, 800)], 'fifo');
    expect(s.sales[0].cost).toBe(10 * 500 + 5 * 600);
    expect(s.holdings).toBe(15);
    expect(s.avgCost).toBe(600);
  });

  it('agrees on the total once everything is sold', () => {
    const all = [...buys(), tx('sell', 15, 800), tx('sell', 15, 700)];
    expect(replay(all, 'fifo').realized).toBe(replay(all, 'average').realized);
    expect(replay(all, 'average').holdings).toBe(0);
  });

  it('takes the AH cut off the proceeds', () => {
    // Sell 10 @ 8s with 4s cut: net 76s; cost 50s.
    const s = replay([tx('buy', 10, 500), tx('sell', 10, 800, 400)], 'average');
    expect(s.sales[0]).toMatchObject({ net: 7_600, cost: 5_000, profit: 2_600 });
  });

  it('does not let sells move the average', () => {
    const s = replay([tx('buy', 10, 500), tx('sell', 5, 900), tx('buy', 5, 800)], 'average');
    // 5 left @ 5s, plus 5 @ 8s: 10 @ 6s 50c.
    expect(s.avgCost).toBe(650);
  });

  it('writes off stock removed by an adjustment, outside profit', () => {
    const s = replay([tx('buy', 10, 500), tx('adjust', -4, null)], 'average');
    expect(s.holdings).toBe(6);
    expect(s.written).toBe(2_000);
    expect(s.realized).toBe(0);
    expect(s.avgCost).toBe(500);
  });

  it('adds stock from a positive adjustment at the given value', () => {
    const s = replay([tx('buy', 10, 500), tx('adjust', 10, 0)], 'average');
    expect(s.holdings).toBe(20);
    expect(s.avgCost).toBe(250);
  });

  it('flags units sold that were never bought, at zero cost', () => {
    const s = replay([tx('buy', 5, 500), tx('sell', 8, 600)], 'fifo');
    expect(s.oversold).toBe(3);
    expect(s.sales[0]).toMatchObject({ cost: 2_500, oversold: 3 });
    expect(s.holdings).toBe(0);
  });

  it('replays in time order, whatever order it gets', () => {
    const [a, b] = buys();
    const sell = tx('sell', 15, 800);
    expect(replay([sell, b, a], 'fifo')).toEqual(replay([a, b, sell], 'fifo'));
  });

  it('sums profit of recent sales', () => {
    const txs = [tx('buy', 10, 500), tx('sell', 5, 800), tx('sell', 5, 900)];
    const s = replay(txs, 'average');
    expect(realizedSince(s, 0)).toBe(s.realized);
    expect(realizedSince(s, txs[2].occurredAt)).toBe(5 * 900 - 2_500);
    expect(realizedSince(s, Infinity)).toBe(0);
  });

  it('values holdings at the market price after the cut', () => {
    const s = replay(buys(), 'average');
    expect(unrealized(s, 570)).toBe(30 * 570 - 17_000);
    expect(unrealized(s, null)).toBeNull();
    expect(unrealized(replay([], 'average'), 570)).toBeNull();
  });
});
