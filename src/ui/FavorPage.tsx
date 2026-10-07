import { Fragment, useState, type ClipboardEvent } from 'react';
import { crateCost, crateTier, isCrateName, matchBundles, type CrateCost } from '../engine/favor';
import type { AhType, FavorCrate, Qty } from '../engine/types';
import { importCrates, syncCratesFromCatalog, type CrateImportResult } from '../state/favorImport';
import { useStore } from '../state/store';
import { extractWowheadRefs, parseCrateBundles, type PastedRef } from '../wowhead/adapter';
import { errorText, ItemName, ItemPicker, Money, NumberInput, Panel, Segmented } from './common';
import { AhPriceAge, AhPriceCell, VendorBuyCell } from './PriceCells';
import { RowActions } from './Selection';
import { SortHeader, sortRows, useSort, type SortValue } from './sorting';

const COLS = 7;
type SortKey = 'name' | 'favor' | 'crate' | 'bundle' | 'total' | 'perFavor';

const shortName = (c: FavorCrate) => c.name.replace(/^Waylaid Crate:\s*/, '') || c.name;

/**
 * Merchant Favor calculator: what a point of favor costs through each Waylaid Crate, from the AH
 * prices of the crate and of the goods that fill it.
 */
export function FavorPage() {
  const { favorCrates, engine, mutate } = useStore();
  const [importing, setImporting] = useState(false);
  const [synced, setSynced] = useState<CrateImportResult | null>(null);
  const sort = useSort<SortKey>('perFavor');
  const [ahType, setAhType] = useState<AhType>('faction');
  const [countCrate, setCountCrate] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);

  const costs = new Map(favorCrates.map((c) => [c.id, crateCost(engine, c, ahType, countCrate)]));
  const best = favorCrates.reduce<number | null>((b, c) => {
    const p = costs.get(c.id)!.perFavor;
    return p !== null && (b === null || p < b) ? p : b;
  }, null);

  const rows = sortRows(
    favorCrates,
    sort,
    (c, key): SortValue => {
      const cost = costs.get(c.id)!;
      switch (key) {
        case 'name':
          // Game order: by tier, then by name.
          return `${crateTier(c.name)} ${shortName(c).replace(/^(Earthly|Flowering) (.*)$/, '$2 $1')}`;
        case 'favor':
          return c.favor;
        case 'crate':
          return cost.crateCost;
        case 'bundle':
          return cost.cheapest?.cost;
        case 'total':
          return cost.total;
        case 'perFavor':
          return cost.perFavor;
      }
    },
    (c) => `${crateTier(c.name)} ${c.name}`,
  );

  const save = (crate: FavorCrate) => mutate((repo) => repo.saveFavorCrate(crate));
  const remove = (crate: FavorCrate) => {
    if (!confirm(`Delete ${crate.name}?`)) return;
    mutate((repo) => repo.deleteFavorCrate(crate.id));
    if (editing === crate.id) setEditing(null);
  };
  const addCrate = () => {
    const id = mutate((repo) => repo.saveFavorCrate({ id: 0, name: 'Waylaid Crate: ', itemId: null, favor: null, bundles: [], notes: '' }));
    setEditing(id);
  };

  return (
    <div className="stack">
      <Panel
        title="Merchant Favor"
        actions={
          <>
            <button
              onClick={() => setSynced({ crates: mutate((repo) => syncCratesFromCatalog(repo)), ignored: [], errors: [] })}
              title="Link crate items you already have to their crates and read their bundles again, for example after importing trade goods"
            >
              Match from tooltips
            </button>
            <button onClick={() => setImporting(!importing)}>Import crates</button>
            <button onClick={addCrate}>Add crate</button>
          </>
        }
      >
        {importing && <CrateImport onDone={setSynced} onClose={() => setImporting(false)} />}
        {synced && <SyncReport result={synced} onClose={() => setSynced(null)} />}
        <p className="small muted">
          Merchant Favor buys recipes. Fill a Waylaid Crate with any one of its bundles to get favor. The cost of a crate is its own AH price plus the
          cheapest bundle, bought on the AH or from a vendor when that is cheaper. Open a crate to set prices, its item and its bundles. A total marked
          "+ crate" leaves out a crate that has no AH price yet.
        </p>
        <div className="table-filters">
          <Segmented
            label="Auction house"
            value={ahType}
            onChange={setAhType}
            options={[
              { value: 'faction', label: 'Faction AH' },
              { value: 'neutral', label: 'Neutral AH' },
            ]}
          />
          <label className="inline small" title="A crate you found could be sold instead, so it costs its AH price either way.">
            <input type="checkbox" checked={countCrate} onChange={(e) => setCountCrate(e.target.checked)} />
            Count the crate at its AH price
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="Crate" k="name" sort={sort} />
                <SortHeader label="Favor" k="favor" sort={sort} className="r tight" />
                <SortHeader label="Crate price" k="crate" sort={sort} className="r tight" />
                <SortHeader label="Cheapest bundle" k="bundle" sort={sort} className="r" />
                <SortHeader label="Total" k="total" sort={sort} className="r tight" />
                <SortHeader label="Per favor" k="perFavor" sort={sort} className="r tight" />
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((crate) => {
                const cost = costs.get(crate.id)!;
                const isBest = cost.perFavor !== null && cost.perFavor === best;
                return (
                  <Fragment key={crate.id}>
                    <tr className={editing === crate.id ? 'editing' : ''}>
                      <td>
                        {crate.itemId !== null ? <ItemName id={crate.itemId} /> : crate.name}
                        {crate.bundles.length === 0 && <span className="muted small"> · no bundles yet</span>}
                      </td>
                      <td className="r tight">{crate.favor ?? <span className="muted">?</span>}</td>
                      <td className="r tight">
                        {countCrate && crate.itemId === null ? <span className="muted small">no item</span> : <Money value={cost.crateCost} />}
                      </td>
                      <td className="r">
                        {cost.cheapest ? (
                          <span className="small">
                            {cost.cheapest.qty} × <ItemName id={cost.cheapest.itemId} /> <Money value={cost.cheapest.cost} />
                          </span>
                        ) : (
                          <span className="muted small">{crate.bundles.length ? 'no prices' : '-'}</span>
                        )}
                      </td>
                      <td className="r tight" title={cost.crateMissing && cost.total !== null ? 'Without the crate: it has no AH price' : undefined}>
                        <Money value={cost.total} />
                        {cost.crateMissing && cost.total !== null && <span className="muted small"> + crate</span>}
                      </td>
                      <td className={`r tight ${isBest ? 'pos' : ''}`} title={isBest ? 'Cheapest favor' : undefined}>
                        <Money value={cost.perFavor === null ? null : Math.round(cost.perFavor)} />
                      </td>
                      <td className="actions">
                        <RowActions
                          name={crate.name}
                          editing={editing === crate.id}
                          onEdit={() => setEditing(crate.id)}
                          onSave={() => setEditing(null)}
                          onDelete={() => remove(crate)}
                        />
                      </td>
                    </tr>
                    {editing === crate.id && (
                      <tr className="editor-row">
                        <td colSpan={COLS}>
                          <CrateEditor crate={crate} cost={cost} ahType={ahType} onSave={save} onClose={() => setEditing(null)} onDelete={() => remove(crate)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLS} className="muted">
                    No crates yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/** Edits save as you go: every field commits on blur, like the price cells. */
function CrateEditor({
  crate,
  cost,
  ahType,
  onSave,
  onClose,
  onDelete,
}: {
  crate: FavorCrate;
  cost: CrateCost;
  ahType: AhType;
  onSave: (crate: FavorCrate) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { itemRecords, engine } = useStore();
  const [newItem, setNewItem] = useState<number | null>(null);
  const [newQty, setNewQty] = useState<number | null>(null);
  const tooltip = crate.itemId === null ? null : (itemRecords.find((r) => r.id === crate.itemId)?.rawTooltip ?? null);
  const { unmatched } = matchBundles(tooltip ? parseCrateBundles(tooltip) : [], engine.items.values());
  const update = (patch: Partial<FavorCrate>) => onSave({ ...crate, ...patch });
  const setBundle = (i: number, patch: Partial<Qty>) => update({ bundles: crate.bundles.map((b, k) => (k === i ? { ...b, ...patch } : b)) });

  return (
    <Panel
      title={`Edit ${shortName(crate)}`}
      actions={
        <>
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="field-row">
        <label className="grow">
          Name
          <input defaultValue={crate.name} onBlur={(e) => e.target.value.trim() && e.target.value !== crate.name && update({ name: e.target.value.trim() })} />
        </label>
        <label>
          Crate item
          <ItemPicker value={crate.itemId} onChange={(id) => update({ itemId: id })} placeholder="Crate name or ID" />
        </label>
        <label>
          Favor
          <NumberInput value={crate.favor} min={0} step={1} placeholder="unknown" onChange={(v) => update({ favor: v === null ? null : Math.max(0, Math.round(v)) })} />
        </label>
        {crate.itemId !== null && (
          <label>
            Crate AH price <AhPriceAge itemId={crate.itemId} ahType={ahType} />
            <AhPriceCell itemId={crate.itemId} ahType={ahType} />
          </label>
        )}
      </div>

      <h3>Bundles</h3>
      <p className="small muted">Any one of these fills the crate, as listed on its tooltip.</p>
      <table className="form-table">
        <thead>
          <tr>
            <th>Qty</th>
            <th>Item</th>
            <th>AH price</th>
            <th>Vendor price</th>
            <th className="r">Bundle cost</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cost.bundles.map((b, i) => (
            <tr key={i} className={cost.cheapest === b ? 'pos' : ''}>
              <td>
                <NumberInput value={b.qty} min={1} step={1} onChange={(v) => v !== null && v > 0 && setBundle(i, { qty: Math.round(v) })} />
              </td>
              <td>
                <ItemPicker value={b.itemId} onChange={(id) => id !== null && setBundle(i, { itemId: id })} />
              </td>
              <td>
                <AhPriceCell itemId={b.itemId} ahType={ahType} /> <AhPriceAge itemId={b.itemId} ahType={ahType} />
              </td>
              <td>
                <VendorBuyCell itemId={b.itemId} />
              </td>
              <td className="r">
                <Money value={b.cost} />
                {b.source === 'vendor' && <span className="muted small"> vendor</span>}
                {cost.cheapest === b && <span className="small"> cheapest</span>}
              </td>
              <td>
                <button className="icon-btn" onClick={() => update({ bundles: crate.bundles.filter((_, k) => k !== i) })} aria-label="Remove bundle">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {unmatched.length > 0 && (
        <p className="small warn">
          On the tooltip but not in your items: {unmatched.map((u) => `${u.qty} ${u.name}`).join(', ')}. Add them below by item ID, or import them and
          press Match from tooltips.
        </p>
      )}
      <div className="add-row">
        <NumberInput value={newQty} min={1} step={1} placeholder="qty" onChange={setNewQty} />
        <ItemPicker value={newItem} onChange={setNewItem} placeholder="Trade good name or ID" />
        <button
          disabled={newItem === null || !newQty || newQty <= 0}
          onClick={() => {
            update({ bundles: [...crate.bundles, { itemId: newItem!, qty: Math.round(newQty!) }] });
            setNewItem(null);
            setNewQty(null);
          }}
        >
          Add bundle
        </button>
      </div>
    </Panel>
  );
}

/**
 * Paste Waylaid Crate rows copied from a Wowhead Forever item list. Each crate is imported, linked
 * to its crate by name, and its bundles are read from the tooltip.
 */
function CrateImport({ onDone, onClose }: { onDone: (r: CrateImportResult) => void; onClose: () => void }) {
  const { mutateAsync } = useStore();
  const [refs, setRefs] = useState<PastedRef[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const found = extractWowheadRefs(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain')).filter(
      (r) => r.type === 'item' && (r.name === null || isCrateName(r.name)),
    );
    setRefs(found);
    setHint(
      found.length
        ? null
        : 'No Waylaid Crate links in that paste. On Wowhead, search for "Waylaid Crate", select the rows in the list and copy them from the browser: the links carry the item IDs.',
    );
  };
  const run = async () => {
    try {
      onDone(await mutateAsync((repo) => importCrates(repo, refs.map((r) => r.id), (d, t) => setProgress(`${d} of ${t}`))));
      onClose();
    } catch (e) {
      setHint(errorText(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="bulk-section">
      <div className="bulk-head">
        <h3>Import crates from Wowhead</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="small muted">
        Search Wowhead Forever for "Waylaid Crate", select the rows and copy them, then paste here. Each crate's tooltip lists its bundles by item
        name; they are matched to your items by name. Import trade goods that are missing from your items, then press Match from tooltips.
      </p>
      <textarea className="paste-zone" rows={3} placeholder="Paste here (Ctrl+V)" onPaste={onPaste} value="" onChange={() => {}} />
      {hint && <p className="small warn">{hint}</p>}
      {refs.length > 0 && (
        <div className="add-row">
          <span className="small">
            {refs.length} crate{refs.length === 1 ? '' : 's'} found
          </span>
          <button className="primary" disabled={progress !== null} onClick={run}>
            {progress ? `Importing ${progress}` : `Import ${refs.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

function SyncReport({ result, onClose }: { result: CrateImportResult; onClose: () => void }) {
  const { crates, ignored, errors } = result;
  const missing = new Map<string, number>();
  for (const c of crates) for (const u of c.unmatched) missing.set(u.name, (missing.get(u.name) ?? 0) + 1);
  const noList = crates.filter((c) => c.noList);
  return (
    <div className="bulk-section small">
      <p>
        {crates.length === 0
          ? errors.length
            ? 'No crates imported.'
            : 'No crate items in your items yet: use Import crates.'
          : `${crates.length} crate${crates.length === 1 ? '' : 's'} linked (${crates.filter((c) => c.created).length} new), ${crates.reduce((s, c) => s + c.matched, 0)} bundles matched.`}{' '}
        <button className="link-btn" onClick={onClose}>
          dismiss
        </button>
      </p>
      {missing.size > 0 && (
        <p className="warn">
          Not in your items yet, so left out: {[...missing.keys()].sort().join(', ')}. Import them (Items, bulk import), then press Match from tooltips.
        </p>
      )}
      {noList.length > 0 && <p className="muted">No bundle list in the tooltip of: {noList.map((c) => c.name).join(', ')}. Their bundles were kept.</p>}
      {ignored.length > 0 && <p className="muted">Not a Waylaid Crate, skipped: {ignored.join(', ')}.</p>}
      {errors.length > 0 && <p className="neg">{errors.join(' · ')}</p>}
    </div>
  );
}
