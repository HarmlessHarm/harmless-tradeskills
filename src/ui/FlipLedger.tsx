import { useState } from 'react';
import { cutOnSale, netOnSale } from '../engine/ah';
import { formatMoney } from '../engine/money';
import { type CostMethod, type Transaction, type TransactionKind, unrealized } from '../engine/ledger';
import type { Config, Copper } from '../engine/types';
import { useStore } from '../state/store';
import { ago, fmtQty, Money, MoneyInput, NumberInput, Segmented } from './common';
import type { Row } from './FlipPage';

/** Transactions listed in the card, newest first. */
const LIST_LIMIT = 10;

/** A manual transaction, with the AH cut filled in for a sell. */
export function manualTransaction(
  config: Config,
  r: Pick<Row, 'watch' | 'settings'>,
  kind: TransactionKind,
  qty: number,
  unitPrice: Copper | null,
): Transaction {
  const fee = kind === 'sell' && unitPrice !== null ? Math.abs(qty) * cutOnSale(config, unitPrice, r.settings.ahType) : 0;
  return {
    uid: `manual-${crypto.randomUUID()}`,
    itemId: r.watch.itemId,
    kind,
    qty,
    unitPrice,
    fee,
    ahType: r.settings.ahType,
    occurredAt: Date.now(),
    source: 'manual',
    note: '',
  };
}

const KIND_LABEL: Record<TransactionKind, string> = { buy: 'Buy', sell: 'Sell', adjust: 'Adjust' };

/**
 * The flip ledger for one watchlist row (#19 step 5, DEC-26): log buys, sells and stock adjustments,
 * see holdings, cost basis and profit.
 */
export function LedgerCard({ r, config }: { r: Row; config: Config }) {
  const { mutate } = useStore();
  const [kind, setKind] = useState<TransactionKind>('buy');
  const [qty, setQty] = useState<number | null>(null);
  const [price, setPrice] = useState<Copper | null>(null);
  const { ledger } = r;
  const method = config.ledgerCostMethod;

  const suggested = kind === 'buy' ? (r.settings.buyPrice ?? r.row.lastLow) : kind === 'sell' ? r.row.sellAt : null;
  const unitPrice = price ?? (kind === 'adjust' ? null : suggested);
  const signedQty = kind === 'adjust' ? (qty ?? 0) : Math.abs(qty ?? 0);
  const canLog = signedQty !== 0 && (kind === 'adjust' || unitPrice !== null);
  const typicalNet = r.row.typical !== null ? netOnSale(config, r.row.typical, r.settings.ahType) : null;
  const open = unrealized(ledger, typicalNet);

  const log = () => {
    if (!canLog) return;
    mutate((repo) => repo.addTransaction(manualTransaction(config, r, kind, signedQty, kind === 'adjust' && signedQty < 0 ? null : unitPrice)));
    setQty(null);
    setPrice(null);
  };
  const remove = (tx: Transaction) => {
    if (tx.id === undefined) return;
    if (!confirm(`Delete this ${tx.kind} of ${Math.abs(tx.qty)} from ${new Date(tx.occurredAt).toLocaleString()}?`)) return;
    mutate((repo) => repo.deleteTransaction(tx.id!));
  };
  const profitByUid = new Map(ledger.sales.map((s) => [s.tx.uid, s.profit]));
  const recent = [...r.txs].reverse().slice(0, LIST_LIMIT);

  return (
    <div className="ledger-card">
      <div className="card-head">
        <h4>Ledger</h4>
        <Segmented<CostMethod>
          value={method}
          options={[
            { value: 'average', label: 'Average cost' },
            { value: 'fifo', label: 'FIFO' },
          ]}
          onChange={(v) => mutate((repo) => repo.saveConfig({ ...config, ledgerCostMethod: v }))}
        />
      </div>

      <dl className="obs-stats">
        <div>
          <dt>Holding</dt>
          <dd>{fmtQty(ledger.holdings)}</dd>
        </div>
        <div>
          <dt>{method === 'fifo' ? 'Cost each (FIFO)' : 'Avg cost'}</dt>
          <dd>
            <Money value={ledger.avgCost} />
          </dd>
        </div>
        <div>
          <dt>Realized</dt>
          <dd>
            <Money value={ledger.sales.length ? ledger.realized : null} signed />
          </dd>
        </div>
        <div title="Lowest sell price that gets back what you paid: cost, AH cut and one lost deposit">
          <dt>Floor</dt>
          <dd className={r.row.belowFloor ? 'warn' : ''}>
            <Money value={r.row.floor} />
          </dd>
        </div>
        <div title="Holdings at the typical price after the AH cut, minus what they cost">
          <dt>Unrealized</dt>
          <dd>
            <Money value={open} signed />
          </dd>
        </div>
      </dl>
      {r.row.belowFloor && (
        <p className="small warn">
          Selling at <Money value={r.row.sellAt} /> does not cover your floor of <Money value={r.row.floor} />: the market is under what you paid. What you paid is
          gone either way, so decide on today's price: hold for a better market, or sell and take the loss.
        </p>
      )}
      {ledger.oversold > 0 && (
        <p className="small warn">
          {ledger.oversold} sold {ledger.oversold === 1 ? 'unit was' : 'units were'} never logged as bought: they count at zero cost. Log the buy or an adjustment to fix it.
        </p>
      )}

      <form
        className="record-form"
        onSubmit={(e) => {
          e.preventDefault();
          log();
        }}
      >
        <Segmented<TransactionKind>
          value={kind}
          options={[
            { value: 'buy', label: 'Buy' },
            { value: 'sell', label: 'Sell' },
            { value: 'adjust', label: 'Adjust' },
          ]}
          onChange={(v) => {
            setKind(v);
            setPrice(null);
          }}
        />
        <label>
          {kind === 'adjust' ? 'Qty (+/-)' : 'Qty'}
          <NumberInput value={qty} onChange={setQty} step={1} min={kind === 'adjust' ? undefined : 1} placeholder={kind === 'adjust' ? '-5' : '20'} />
        </label>
        {!(kind === 'adjust' && signedQty < 0) && (
          <label>
            {kind === 'buy' ? 'Paid each' : kind === 'sell' ? 'Sold each' : 'Value each'}
            <MoneyInput value={price} onChange={setPrice} placeholder={suggested !== null ? formatMoney(suggested) : kind === 'adjust' ? '0' : 'e.g. 45c'} />
          </label>
        )}
        <button type="submit" className="primary" disabled={!canLog}>
          Log
        </button>
      </form>
      <p className="small muted record-hint">
        {kind === 'sell'
          ? `Proceeds are after the ${Math.round(config.ahCut[r.settings.ahType] * 100)}% ${r.settings.ahType} AH cut.`
          : kind === 'adjust'
            ? 'Negative removes stock used in a craft, vendored or destroyed (not profit). Positive adds stock you got another way.'
            : 'The price box suggests what you entered in the calculator, or the last low.'}
      </p>

      {recent.length > 0 && (
        <table className="obs-list">
          <caption className="sr-only">Ledger, newest first</caption>
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th className="r">Qty</th>
              <th className="r">Each</th>
              <th className="r">Profit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recent.map((tx) => (
              <tr key={tx.uid}>
                <td title={new Date(tx.occurredAt).toLocaleString()}>{ago(tx.occurredAt)}</td>
                <td className={`tx-${tx.kind}`}>
                  {KIND_LABEL[tx.kind]}
                  {tx.source !== 'manual' && <span className="badge">{tx.source}</span>}
                </td>
                <td className="r">{tx.kind === 'adjust' && tx.qty > 0 ? `+${tx.qty}` : tx.kind === 'sell' ? `-${Math.abs(tx.qty)}` : tx.qty}</td>
                <td className="r">
                  <Money value={tx.unitPrice} />
                </td>
                <td className="r">{tx.kind === 'sell' ? <Money value={profitByUid.get(tx.uid)} signed /> : null}</td>
                <td className="actions">
                  <button
                    className="row-icon delete"
                    onClick={() => remove(tx)}
                    title="Delete this transaction"
                    aria-label={`Delete ${tx.kind} from ${new Date(tx.occurredAt).toLocaleString()}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.txs.length > LIST_LIMIT && (
        <p className="muted small">
          Showing the latest {LIST_LIMIT} of {r.txs.length}.
        </p>
      )}
    </div>
  );
}

