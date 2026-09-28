import type { AhType, Copper } from './types';

/**
 * Manual flip ledger (#19 step 5, DEC-26): buys, sells and stock adjustments per item, with holdings,
 * cost basis and profit. Market prices set what to sell at; cost only sets the floor and the profit.
 */

export type TransactionKind = 'buy' | 'sell' | 'adjust';
export type TransactionSource = 'manual' | 'addon';

export interface Transaction {
  /** Database id; absent before saving. */
  id?: number;
  /** Stable id, so an addon import can skip transactions that were already logged. */
  uid: string;
  itemId: number;
  kind: TransactionKind;
  /**
   * Units. Positive for buys and sells. For an adjustment: negative removes stock (used in a craft,
   * vendored, destroyed), positive adds stock you got another way.
   */
  qty: number;
  /** Price per unit: paid for a buy, listed for a sell, value of added stock for an adjustment (else null). */
  unitPrice: Copper | null;
  /** AH cut and other fees paid on a sell, for the whole transaction. */
  fee: Copper;
  ahType: AhType;
  occurredAt: number;
  source: TransactionSource;
  note: string;
}

/**
 * 'average': weighted moving average. A buy moves the average; sells and removals leave it.
 * 'fifo': the oldest units leave first, so remaining stock is valued at the latest buys (like TSM's SmartAvgBuy).
 * Totals agree once everything is sold; the method only changes when profit shows up.
 */
export type CostMethod = 'average' | 'fifo';

export interface SaleResult {
  tx: Transaction;
  /** Net proceeds: price x qty minus fees. */
  net: Copper;
  /** Cost basis of the units sold, under the chosen method. */
  cost: Copper;
  profit: Copper;
  /** Units sold beyond what the ledger held; they count at zero cost. */
  oversold: number;
}

export interface LedgerState {
  holdings: number;
  /** Cost basis of the units held. */
  costRemaining: Copper;
  /** Cost per unit held, or null with nothing held. */
  avgCost: Copper | null;
  realized: Copper;
  sales: SaleResult[];
  /** Cost of stock removed by adjustments (used, vendored, destroyed): not a sale, so not in profit. */
  written: Copper;
  /** Units sold that the ledger never saw bought. */
  oversold: number;
}

interface Lot {
  qty: number;
  unit: number;
}

/** Replays an item's transactions in time order. */
export function replay(transactions: Transaction[], method: CostMethod): LedgerState {
  const txs = [...transactions].sort((a, b) => a.occurredAt - b.occurredAt || (a.id ?? 0) - (b.id ?? 0));
  const lots: Lot[] = [];
  let holdings = 0;
  let pool = 0; // total cost of units held (average method)
  let realized = 0;
  let written = 0;
  let oversold = 0;
  const sales: SaleResult[] = [];

  const add = (qty: number, unit: number) => {
    if (method === 'fifo') lots.push({ qty, unit });
    else pool += qty * unit;
    holdings += qty;
  };
  /** Takes up to `qty` units out of stock and returns their cost and how many were missing. */
  const take = (qty: number): { cost: number; missing: number } => {
    const n = Math.min(qty, holdings);
    let cost = 0;
    if (method === 'fifo') {
      let left = n;
      while (left > 0 && lots.length) {
        const lot = lots[0];
        const used = Math.min(left, lot.qty);
        cost += used * lot.unit;
        lot.qty -= used;
        left -= used;
        if (lot.qty === 0) lots.shift();
      }
    } else if (holdings > 0) {
      cost = (pool / holdings) * n;
      pool -= cost;
    }
    holdings -= n;
    if (holdings === 0) pool = 0;
    return { cost, missing: qty - n };
  };

  for (const tx of txs) {
    const qty = Math.abs(Math.floor(tx.qty));
    if (qty === 0) continue;
    if (tx.kind === 'buy') add(qty, tx.unitPrice ?? 0);
    else if (tx.kind === 'adjust') {
      if (tx.qty > 0) add(qty, tx.unitPrice ?? 0);
      else written += take(qty).cost;
    } else {
      const net = (tx.unitPrice ?? 0) * qty - tx.fee;
      const { cost, missing } = take(qty);
      const c = Math.round(cost);
      oversold += missing;
      realized += net - c;
      sales.push({ tx, net, cost: c, profit: net - c, oversold: missing });
    }
  }

  const costRemaining = method === 'fifo' ? lots.reduce((s, l) => s + l.qty * l.unit, 0) : pool;
  return {
    holdings,
    costRemaining: Math.round(costRemaining),
    avgCost: holdings > 0 ? Math.round(costRemaining / holdings) : null,
    realized: Math.round(realized),
    sales,
    written: Math.round(written),
    oversold,
  };
}

/** Holdings valued at a market price after the AH cut, minus what they cost. */
export function unrealized(state: LedgerState, netPerUnit: Copper | null): Copper | null {
  if (state.holdings === 0 || netPerUnit === null) return null;
  return state.holdings * netPerUnit - state.costRemaining;
}
