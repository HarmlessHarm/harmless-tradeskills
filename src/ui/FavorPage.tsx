import { Fragment, useState } from 'react';
import { crateCost, type CrateCost } from '../engine/favor';
import type { AhType, FavorCrate, Qty } from '../engine/types';
import { useStore } from '../state/store';
import { ItemName, ItemPicker, Money, NumberInput, Panel, Segmented } from './common';
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
          return c.id;
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
    (c) => String(c.id).padStart(6, '0'),
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
      <Panel title="Merchant Favor" actions={<button onClick={addCrate}>Add crate</button>}>
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
  const [newItem, setNewItem] = useState<number | null>(null);
  const [newQty, setNewQty] = useState<number | null>(null);
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
