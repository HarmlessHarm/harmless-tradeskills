import { useState, type ClipboardEvent } from 'react';
import { importVendorPrices, type VendorPriceResult } from '../state/importer';
import { useStore } from '../state/store';
import { extractVendorPrices, extractWowheadRefs, type PastedVendorPrice } from '../wowhead/adapter';
import { errorText, Money } from './common';

/**
 * Select rows in a vendor's "Sells" table on Wowhead, copy, and paste here. Each item's listed
 * cost becomes its vendor buy price. Use a vendor that sells at the base price (no reputation
 * discount), since stored vendor prices are base prices (DEC-8).
 */
export function VendorPriceImport({ onClose }: { onClose: () => void }) {
  const { itemRecords, mutateAsync } = useStore();
  const [rows, setRows] = useState<PastedVendorPrice[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VendorPriceResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const current = (id: number) => itemRecords.find((r) => r.id === id);

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const found = extractVendorPrices(html);
    setRows(found);
    setResult(null);
    // Preselect what would change; items not in the catalog yet only if they are not recipes.
    setPicked(new Set(found.filter((r) => current(r.itemId)?.vendorBuy !== r.price && !(!current(r.itemId) && isRecipeItem(r))).map((r) => r.itemId)));
    if (found.length) setHint(null);
    else if (extractWowheadRefs(html).some((r) => r.type === 'item'))
      setHint('Found item links but no prices in that paste. Copy rows from a vendor\'s "Sells" table, including the Cost column.');
    else setHint('No Wowhead items found in that paste. On a vendor\'s Wowhead page, select rows in the "Sells" table and copy them.');
  };

  const setMany = (ids: number[], on: boolean) => {
    const next = new Set(picked);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setPicked(next);
  };

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const chosen = rows.filter((r) => picked.has(r.itemId));
      setResult(await mutateAsync((repo) => importVendorPrices(repo, chosen, (d, t) => setProgress(`${d} of ${t}`))));
    } catch (e) {
      setResult({ updated: 0, unchanged: 0, imported: 0, errors: [errorText(e)] });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const chosen = rows.filter((r) => picked.has(r.itemId));
  const toFetch = chosen.filter((r) => !current(r.itemId)).length;

  return (
    <div className="bulk-section">
      <div className="bulk-head">
        <h3>Vendor prices from Wowhead</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="small muted">
        On a vendor's Wowhead Forever page, select rows in the "Sells" table and copy them. Paste below. The listed cost is saved as each item's
        vendor buy price, so pick a vendor that sells at the base price (no reputation discount).
      </p>
      <textarea className="paste-zone" rows={3} placeholder="Paste here (Ctrl+V)" onPaste={onPaste} value="" onChange={() => {}} />
      {hint && <p className="small warn">{hint}</p>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="check">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={rows.every((r) => picked.has(r.itemId))}
                      onChange={(e) => setMany(rows.map((r) => r.itemId), e.target.checked)}
                    />
                  </th>
                  <th>Item</th>
                  <th>Vendor price</th>
                  <th>Current</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rec = current(r.itemId);
                  const status = !rec ? 'not in catalog' : rec.vendorBuy === r.price ? 'same' : rec.vendorBuy === null ? 'new price' : 'changed';
                  return (
                    <tr key={r.itemId} className={picked.has(r.itemId) ? 'selected' : ''}>
                      <td className="check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name ?? r.itemId}`}
                          checked={picked.has(r.itemId)}
                          onChange={(e) => setMany([r.itemId], e.target.checked)}
                        />
                      </td>
                      <td>
                        {r.name ?? <span className="muted">unnamed</span>} <span className="muted small">#{r.itemId}</span>
                      </td>
                      <td>
                        <Money value={r.price} />
                      </td>
                      <td>{rec ? <Money value={rec.vendorBuy} /> : <span className="muted">-</span>}</td>
                      <td className="small">
                        <span className={status === 'same' ? 'muted' : 'badge'}>{status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="add-row">
            <button className="link-btn" onClick={() => setPicked(new Set(rows.filter((r) => current(r.itemId)).map((r) => r.itemId)))}>
              only items I have
            </button>
            <button disabled={running || chosen.length === 0} onClick={run}>
              {running
                ? `Saving ${progress ?? ''}`
                : `Save ${chosen.length} price${chosen.length === 1 ? '' : 's'}${toFetch ? ` (imports ${toFetch} new item${toFetch === 1 ? '' : 's'})` : ''}`}
            </button>
          </div>
        </>
      )}
      {result && (
        <div className="small">
          <p>
            Updated {result.updated}
            {result.unchanged > 0 && `, ${result.unchanged} already had that price`}
            {result.imported > 0 && `, imported ${result.imported} new item${result.imported === 1 ? '' : 's'}`}
            {result.errors.length > 0 && `, ${result.errors.length} failed`}.
          </p>
          {result.errors.map((m, i) => (
            <p key={i} className="warn">
              {m}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Patterns, plans, formulas and the like: sold by the same vendors, rarely wanted as items. */
const isRecipeItem = (r: PastedVendorPrice) => /^(Pattern|Plans|Formula|Recipe|Schematic|Manual|Design|Technique):/i.test(r.name ?? '');
