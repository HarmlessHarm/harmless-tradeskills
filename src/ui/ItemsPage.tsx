import { Fragment, useState, type ReactNode } from 'react';
import { effectiveItem } from '../engine/items';
import { QUALITY_NAMES, type ItemClass, type ItemFields, type ItemRecord, type Quality } from '../engine/types';
import { createManualItem } from '../state/actions';
import { importItem, importRecipe } from '../state/importer';
import { useStore } from '../state/store';
import { parseWowheadRef, tooltipText, wowheadUrl } from '../wowhead/adapter';
import { ago, errorText, ItemName, Money, MoneyInput, NumberInput, Panel } from './common';
import { deleteConfirmText, itemUsage } from '../state/usage';
import { BulkImport } from './BulkImport';
import { VendorPriceImport } from './VendorPriceImport';
import { RowActions, RowCheckbox, SelectAll, SelectionBar, useSelection } from './Selection';
import { useEditSession } from './useEditSession';
import { SortHeader, sortRows, useSort, type SortValue } from './sorting';

type ItemSortKey = 'name' | 'ilvl' | 'type' | 'vendorSell' | 'ah';
import { AhPriceAge, AhPriceCell, VendorBuyCell } from './PriceCells';

export function ImportBox({ defaultType }: { defaultType: 'item' | 'spell' }) {
  const { mutateAsync } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const run = async () => {
    const ref = parseWowheadRef(text, defaultType);
    if (!ref) return setMsg({ text: 'Paste a Wowhead link or type an ID.', bad: true });
    setBusy(true);
    setMsg(null);
    try {
      if (ref.type === 'item') {
        const r = await mutateAsync((repo) => importItem(repo, ref.id, { force: true }));
        setMsg({ text: `Imported item ${r.imported.name}.` });
      } else {
        const r = await mutateAsync((repo) => importRecipe(repo, ref.id, { force: true }));
        const notes = [...r.warnings, ...r.itemErrors];
        setMsg({ text: `Imported recipe ${r.recipe.imported.name}.${notes.length ? ` ${notes.join(' ')}` : ''}`, bad: notes.length > 0 });
      }
      setText('');
    } catch (e) {
      setMsg({ text: errorText(e), bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="import-box">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && run()}
        placeholder={`Paste a Wowhead Forever link or ${defaultType} ID`}
      />
      <button disabled={busy || !text.trim()} onClick={run}>
        {busy ? 'Importing...' : 'Import'}
      </button>
      {msg && <span className={`small ${msg.bad ? 'warn' : 'muted'}`}>{msg.text}</span>}
    </div>
  );
}

export function ItemsPage() {
  const { itemRecords, mutate, engine, workflows, deRules, prices } = useStore();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ItemClass>('all');
  const sort = useSort<ItemSortKey>('name');
  const sel = useSelection<number>();
  const edit = useEditSession(itemRecords, (r) => r.id, (r) => mutate((repo) => repo.saveItem(r)));
  const editing = edit.editing;
  const [newId, setNewId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [bulk, setBulk] = useState<'items' | 'vendor' | null>(null);

  const q = search.trim().toLowerCase();
  const ahPrice = new Map(prices.map((p) => [p.itemId, p.ahPrice]));
  const filtered = itemRecords
    .map((r) => ({ r, it: effectiveItem(r) }))
    .filter(({ it }) => !q || it.name.toLowerCase().includes(q) || String(it.id) === q.replace(/^#/, ''))
    .filter(({ it }) => typeFilter === 'all' || it.itemClass === typeFilter);
  const rows = sortRows(
    filtered,
    sort,
    ({ it }, key): SortValue => {
      switch (key) {
        case 'name':
          return it.name;
        case 'ilvl':
          return it.itemLevel;
        case 'type':
          return [it.itemClass === 'other' ? '' : it.itemClass, it.subclass ?? ''].join(' ').trim();
        case 'vendorSell':
          return it.vendorSell;
        case 'ah':
          return ahPrice.get(it.id);
      }
    },
    ({ it }) => it.name,
  );
  const visibleKeys = rows.map(({ r }) => r.id);
  const filtering = q !== '' || typeFilter !== 'all';

  const remove = (ids: number[]) => {
    if (ids.length === 0) return;
    const names = ids.map((id) => engine.items.get(id)?.name ?? `#${id}`);
    const gone = new Set(ids);
    const usage = ids.flatMap((id) => itemUsage({ engine, workflows, deRules }, id));
    if (!confirm(deleteConfirmText('item', names, usage))) return;
    mutate((repo) => ids.forEach((id) => repo.deleteItem(id)));
    sel.setAll(ids, false);
    if (editing !== null && gone.has(editing)) edit.drop();
  };

  return (
    <div className="stack">
      <Panel
        title="Import items"
        actions={
          <>
            {bulk !== 'items' && <button onClick={() => setBulk('items')}>Bulk import</button>}
            {bulk !== 'vendor' && <button onClick={() => setBulk('vendor')}>Vendor prices</button>}
          </>
        }
      >
        <ImportBox defaultType="item" />
        {bulk === 'items' && <BulkImport onClose={() => setBulk(null)} />}
        {bulk === 'vendor' && <VendorPriceImport onClose={() => setBulk(null)} />}
        <div className="add-manual small">
          <span className="muted">Add by hand:</span>
          <NumberInput value={newId} onChange={setNewId} placeholder="Item ID" />
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" />
          <button
            disabled={!newId || !newName.trim() || itemRecords.some((r) => r.id === newId)}
            onClick={() => {
              mutate((repo) => createManualItem(repo, newId!, newName.trim()));
              setSearch('');
              setTypeFilter('all');
              edit.open(newId!);
              setNewId(null);
              setNewName('');
            }}
          >
            Add
          </button>
        </div>
      </Panel>
      <Panel title={`Items (${filtering ? `${rows.length} of ${itemRecords.length}` : itemRecords.length})`}>
        <div className="table-filters">
          <input type="search" className="search" placeholder="Search name or #ID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search items" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | ItemClass)} aria-label="Filter by type">
            <option value="all">All types</option>
            <option value="armor">Armor</option>
            <option value="weapon">Weapons</option>
            <option value="other">Other</option>
          </select>
          {filtering && (
            <button
              className="link-btn"
              onClick={() => {
                setSearch('');
                setTypeFilter('all');
              }}
            >
              clear filters
            </button>
          )}
        </div>
        <SelectionBar count={sel.selected.size} onDelete={() => remove([...sel.selected])} onClear={sel.clear} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="check">
                  <SelectAll keys={visibleKeys} sel={sel} />
                </th>
                <SortHeader label="Item" k="name" sort={sort} />
                <SortHeader label="iLvl" k="ilvl" sort={sort} className="r" />
                <SortHeader label="Type" k="type" sort={sort} />
                <SortHeader label="Vendor sell" k="vendorSell" sort={sort} />
                <th>Vendor buy</th>
                <SortHeader label="AH price" k="ah" sort={sort} />
                <th>Min AH price</th>
                <th>Price age</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, it }) => (
                <Fragment key={r.id}>
                <tr className={`${sel.has(r.id) ? 'selected' : ''} ${editing === r.id ? 'editing' : ''}`}>
                  <td className="check">
                    <RowCheckbox k={r.id} label={`Select ${it.name}`} visibleKeys={visibleKeys} sel={sel} />
                  </td>
                  <td>
                    <ItemName id={r.id} link />
                    <span className="muted small"> #{r.id}</span>
                  </td>
                  <td className="r">{it.itemLevel ?? '-'}</td>
                  <td className="small">
                    {it.itemClass === 'other' ? '' : it.itemClass}
                    {it.subclass ? ` ${it.subclass}` : ''}
                  </td>
                  <td>
                    <Money value={it.vendorSell} />
                  </td>
                  <td>
                    <VendorBuyCell itemId={r.id} />
                  </td>
                  <td>
                    <AhPriceCell itemId={r.id} />
                  </td>
                  <td>
                    <AhPriceCell itemId={r.id} pessimistic />
                  </td>
                  <td className="small">
                    <AhPriceAge itemId={r.id} />
                  </td>
                  <td className="small">
                    <SourceBadge record={r} />
                  </td>
                  <td className="actions">
                    <RowActions
                      name={it.name}
                      editing={editing === r.id}
                      dirty={editing === r.id && edit.dirty}
                      onEdit={() => edit.open(r.id)}
                      onSave={edit.save}
                      onDelete={() => remove([r.id])}
                    />
                  </td>
                </tr>
                {editing === r.id && edit.working && (
                  <tr className="editor-row">
                    <td colSpan={11}>
                      <ItemEditor
                        record={edit.working}
                        dirty={edit.dirty}
                        update={edit.update}
                        onSave={edit.save}
                        onCancel={edit.cancel}
                        onDelete={() => remove([r.id])}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted">
                    {itemRecords.length ? 'No items match these filters.' : 'No items yet. Import one above, or they get imported when a recipe needs them.'}
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

function SourceBadge({ record }: { record: ItemRecord }) {
  const overridden = Object.keys(record.overrides).length > 0;
  return (
    <span title={`Updated ${new Date(record.updatedAt).toLocaleString()}`}>
      <span className={`badge ${record.source}`}>{record.source}</span>
      {overridden && <span className="badge override">edited</span>}{' '}
      <span className="muted">{ago(record.source === 'wowhead' ? record.fetchedAt : record.updatedAt)}</span>
    </span>
  );
}

/** Edit overrides per field. Imported values stay visible; clearing an override reverts to them (DEC-6). */
function ItemEditor({
  record,
  dirty,
  update,
  onSave,
  onCancel,
  onDelete,
}: {
  record: ItemRecord;
  dirty: boolean;
  update: (fn: (r: ItemRecord) => ItemRecord) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { mutateAsync } = useStore();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set or clear (undefined) an override in the draft. */
  const set = <K extends keyof ItemFields>(key: K, value: ItemFields[K] | undefined) =>
    update((r) => {
      const overrides = { ...r.overrides };
      if (value === undefined) delete overrides[key];
      else overrides[key] = value;
      return { ...r, overrides };
    });
  const imp = record.imported;
  const ov = record.overrides;
  const isManual = record.source === 'manual';

  // For a hand-made item, edits go to the base values instead of overrides.
  const setBase = <K extends keyof ItemFields>(key: K, value: ItemFields[K]) => update((r) => ({ ...r, imported: { ...r.imported, [key]: value } }));
  const put = <K extends keyof ItemFields>(key: K, value: ItemFields[K] | undefined) =>
    isManual ? value !== undefined && setBase(key, value) : set(key, value);
  const cur = <K extends keyof ItemFields>(key: K): ItemFields[K] => (key in ov ? (ov[key] as ItemFields[K]) : imp[key]);

  const row = (label: string, key: keyof ItemFields, editor: ReactNode, shown: ReactNode) => (
    <tr>
      <th>{label}</th>
      <td>{editor}</td>
      <td className="small muted">
        {!isManual && (
          <>
            imported: {shown}
            {key in ov && (
              <button className="link-btn" onClick={() => set(key, undefined)}>
                revert
              </button>
            )}
          </>
        )}
      </td>
    </tr>
  );

  return (
    <Panel
      title={
        <>
          Edit <ItemName id={record.id} />
        </>
      }
      actions={
        <>
          {record.source === 'wowhead' && (
            <>
              <a className="small" href={wowheadUrl('item', record.id)} target="_blank" rel="noreferrer">
                Wowhead
              </a>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    await mutateAsync((repo) => importItem(repo, record.id, { force: true }));
                  } catch (e) {
                    setErr(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Refreshing...' : 'Refresh from Wowhead'}
              </button>
            </>
          )}
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
          {dirty && <span className="unsaved">Unsaved changes</span>}
          <button onClick={onCancel}>{dirty ? 'Cancel' : 'Close'}</button>
          <button className="primary" onClick={onSave}>
            Save
          </button>
        </>
      }
    >
      {err && <p className="warn small">{err}</p>}
      <table className="form-table">
        <tbody>
          {row('Name', 'name', <input value={cur('name')} onChange={(e) => put('name', e.target.value)} />, imp.name)}
          {row(
            'Quality',
            'quality',
            <select value={cur('quality')} onChange={(e) => put('quality', Number(e.target.value) as Quality)}>
              {QUALITY_NAMES.map((q, i) => (
                <option key={q} value={i}>
                  {q}
                </option>
              ))}
            </select>,
            QUALITY_NAMES[imp.quality],
          )}
          {row('Item level', 'itemLevel', <NumberInput value={cur('itemLevel')} onChange={(v) => put('itemLevel', v ?? undefined)} />, imp.itemLevel ?? '-')}
          {row(
            'Type',
            'itemClass',
            <select value={cur('itemClass')} onChange={(e) => put('itemClass', e.target.value as ItemClass)}>
              <option value="armor">Armor</option>
              <option value="weapon">Weapon</option>
              <option value="other">Other</option>
            </select>,
            imp.itemClass,
          )}
          {row('Subtype', 'subclass', <input value={cur('subclass') ?? ''} onChange={(e) => put('subclass', e.target.value || null)} />, imp.subclass ?? '-')}
          {row(
            'Vendor sell',
            'vendorSell',
            <MoneyInput value={cur('vendorSell')} onChange={(v) => put('vendorSell', v)} />,
            <Money value={imp.vendorSell} />,
          )}
        </tbody>
      </table>
      {record.rawTooltip && (
        <details className="raw">
          <summary className="small muted">Raw Wowhead tooltip</summary>
          <pre className="tooltip-text">{tooltipText(record.rawTooltip)}</pre>
        </details>
      )}
    </Panel>
  );
}
