import { Fragment, useState } from 'react';
import { effectiveRecipe } from '../engine/items';
import type { RecipeFields, RecipeOutput, RecipeRecord } from '../engine/types';
import { importRecipe } from '../state/importer';
import { useStore } from '../state/store';
import { tooltipText, wowheadUrl } from '../wowhead/adapter';
import { ago, errorText, ItemName, ItemPicker, NumberInput, Panel } from './common';
import { deleteConfirmText, recipeUsage } from '../state/usage';
import { BulkImport } from './BulkImport';
import { RowActions, SelectAll, SelectionBar, useSelection } from './Selection';
import { useEditSession } from './useEditSession';
import { ImportBox } from './ItemsPage';

const KINDS = ['craft', 'disenchant', 'convert'];

export function RecipesPage() {
  const { recipeRecords, mutate, engine, workflows, deRules } = useStore();
  const edit = useEditSession(recipeRecords, (r) => r.id, (r) => mutate((repo) => repo.saveRecipe(r)));
  const editing = edit.editing;
  const sel = useSelection<string>();
  const [filter, setFilter] = useState('');
  const [bulk, setBulk] = useState(false);

  const f = filter.trim().toLowerCase();
  const rows = recipeRecords
    .map((r) => ({ r, rec: effectiveRecipe(r) }))
    .filter(({ rec }) => !f || rec.name.toLowerCase().includes(f) || rec.id.includes(f))
    .sort((a, b) => a.rec.name.localeCompare(b.rec.name));

  const remove = (ids: string[]) => {
    if (ids.length === 0) return;
    const names = ids.map((id) => engine.recipes.get(id)?.name ?? id);
    const usage = ids.flatMap((id) => recipeUsage({ engine, workflows, deRules }, id));
    if (!confirm(deleteConfirmText('recipe', names, usage))) return;
    mutate((repo) => ids.forEach((id) => repo.deleteRecipe(id)));
    sel.setAll(ids, false);
    if (editing !== null && ids.includes(editing)) edit.drop();
  };

  const createManual = () => {
    const id = mutate((repo) => {
      const id = repo.nextLocalRecipeId();
      const now = Date.now();
      repo.saveRecipe({
        id,
        spellId: null,
        imported: { name: 'New recipe', kind: 'craft', profession: null, castTimeMs: 0, inputs: [], tools: [], outputs: [], outputMode: 'independent' },
        overrides: {},
        source: 'manual',
        fetchedAt: null,
        updatedAt: now,
        rawTooltip: null,
      });
      return id;
    });
    setFilter('');
    edit.open(id);
  };

  return (
    <div className="stack">
      {bulk && <BulkImport onClose={() => setBulk(false)} />}
      <Panel
        title="Recipes"
        actions={
          <>
            <input className="search" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
            {!bulk && <button onClick={() => setBulk(true)}>Bulk import</button>}
            <button onClick={createManual}>New by hand</button>
          </>
        }
      >
        <ImportBox defaultType="spell" />
        <SelectionBar count={sel.selected.size} onDelete={() => remove([...sel.selected])} onClear={sel.clear} />
        <p className="small muted">
          Disenchanting needs no recipe here: add a Disenchant step to a workflow and the matching disenchant rule is used.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="check">
                  <SelectAll keys={rows.map(({ r }) => r.id)} sel={sel} />
                </th>
                <th>Recipe</th>
                <th>Kind</th>
                <th className="r">Cast</th>
                <th>Reagents</th>
                <th>Creates</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, rec }) => (
                <Fragment key={r.id}>
                <tr className={`${sel.has(r.id) ? 'selected' : ''} ${editing === r.id ? 'editing' : ''}`}>
                  <td className="check">
                    <input type="checkbox" aria-label={`Select ${rec.name}`} checked={sel.has(r.id)} onChange={(e) => sel.toggle(r.id, e.target.checked)} />
                  </td>
                  <td>
                    {r.spellId ? (
                      <a href={wowheadUrl('spell', r.spellId)} target="_blank" rel="noreferrer">
                        {rec.name}
                      </a>
                    ) : (
                      rec.name
                    )}
                  </td>
                  <td className="small">{rec.kind}</td>
                  <td className="r small">{rec.castTimeMs / 1000}s</td>
                  <td className="small">
                    {rec.inputs.map((i, k) => (
                      <div key={k}>
                        {i.qty} <ItemName id={i.itemId} />
                      </div>
                    ))}
                  </td>
                  <td className="small">
                    {rec.outputs.map((o, k) => (
                      <div key={k}>
                        {o.minQty === o.maxQty ? o.minQty : `${o.minQty}-${o.maxQty}`} <ItemName id={o.itemId} />
                        {o.chance < 1 && <span className="muted"> {Math.round(o.chance * 1000) / 10}%</span>}
                      </div>
                    ))}
                    {rec.outputs.length === 0 && <span className="warn">none</span>}
                  </td>
                  <td className="small">
                    <span className={`badge ${r.source}`}>{r.source}</span>
                    {Object.keys(r.overrides).length > 0 && <span className="badge override">edited</span>}{' '}
                    <span className="muted">{ago(r.fetchedAt ?? r.updatedAt)}</span>
                  </td>
                  <td className="actions">
                    <RowActions
                      name={rec.name}
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
                    <td colSpan={8}>
                      <RecipeEditor
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
                  <td colSpan={8} className="muted">
                    {recipeRecords.length ? 'No match.' : 'No recipes yet. Paste a Wowhead spell link above.'}
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

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function RecipeEditor({
  record,
  dirty,
  update,
  onSave,
  onCancel,
  onDelete,
}: {
  record: RecipeRecord;
  dirty: boolean;
  update: (fn: (r: RecipeRecord) => RecipeRecord) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { mutateAsync } = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rec = effectiveRecipe(record);
  const isManual = record.source === 'manual';

  /** Manual recipes edit their base values; imported ones get an override per field (DEC-6). */
  const set = <K extends keyof RecipeFields>(key: K, value: RecipeFields[K]) =>
    update((r) => {
      if (r.source === 'manual') return { ...r, imported: { ...r.imported, [key]: value } };
      const overrides = { ...r.overrides };
      if (same(r.imported[key], value)) delete overrides[key];
      else overrides[key] = value;
      return { ...r, overrides };
    });

  const setOutput = (i: number, patch: Partial<RecipeOutput>) => set('outputs', rec.outputs.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const chanceSum = rec.outputs.reduce((s, o) => s + o.chance, 0);

  return (
    <Panel
      title={`Edit ${rec.name}`}
      actions={
        <>
          {!isManual && Object.keys(record.overrides).length > 0 && (
            <button onClick={() => update((r) => ({ ...r, overrides: {} }))}>Reset to imported</button>
          )}
          {record.spellId && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  const r = await mutateAsync((repo) => importRecipe(repo, record.spellId!, { force: true }));
                  if (r.warnings.length || r.itemErrors.length) setErr([...r.warnings, ...r.itemErrors].join(' '));
                } catch (e) {
                  setErr(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Refreshing...' : 'Refresh from Wowhead'}
            </button>
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
      {!isManual && <p className="small muted">Changes are stored as overrides on top of the imported recipe. A refresh keeps them.</p>}
      <div className="field-row">
        <label>
          Name
          <input value={rec.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Kind
          <input list="recipe-kinds" value={rec.kind} onChange={(e) => set('kind', e.target.value)} />
          <datalist id="recipe-kinds">
            {KINDS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </label>
        <label>
          Profession
          <input value={rec.profession ?? ''} onChange={(e) => set('profession', e.target.value || null)} />
        </label>
        <label>
          Cast time (s)
          <NumberInput value={rec.castTimeMs / 1000} step={0.001} min={0} onChange={(v) => set('castTimeMs', Math.round((v ?? 0) * 1000))} />
        </label>
      </div>

      <h3>Reagents</h3>
      <table className="form-table">
        <tbody>
          {rec.inputs.map((input, i) => (
            <tr key={i}>
              <td>
                <ItemPicker
                  value={input.itemId}
                  onChange={(id) => id !== null && set('inputs', rec.inputs.map((x, k) => (k === i ? { ...x, itemId: id } : x)))}
                />
              </td>
              <td>
                <NumberInput
                  value={input.qty}
                  min={1}
                  step={1}
                  onChange={(v) => set('inputs', rec.inputs.map((x, k) => (k === i ? { ...x, qty: Math.max(1, v ?? 1) } : x)))}
                />
              </td>
              <td>
                <button className="icon-btn" onClick={() => set('inputs', rec.inputs.filter((_, k) => k !== i))} aria-label="Remove reagent">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddItemRow label="Add reagent" onAdd={(id) => set('inputs', [...rec.inputs, { itemId: id, qty: 1 }])} />

      <h3>Outputs</h3>
      <label className="inline small">
        <input
          type="checkbox"
          checked={rec.outputMode === 'exclusive'}
          onChange={(e) => set('outputMode', e.target.checked ? 'exclusive' : 'independent')}
        />
        Exactly one output per cast (like disenchanting)
      </label>
      <table className="form-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Chance %</th>
            <th>Min</th>
            <th>Max</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rec.outputs.map((o, i) => (
            <tr key={i}>
              <td>
                <ItemPicker value={o.itemId} onChange={(id) => id !== null && setOutput(i, { itemId: id })} />
              </td>
              <td>
                <NumberInput value={Math.round(o.chance * 10000) / 100} min={0} step={0.1} onChange={(v) => setOutput(i, { chance: Math.min(1, Math.max(0, (v ?? 100) / 100)) })} />
              </td>
              <td>
                <NumberInput value={o.minQty} min={0} step={1} onChange={(v) => setOutput(i, { minQty: v ?? 1, maxQty: Math.max(v ?? 1, o.maxQty) })} />
              </td>
              <td>
                <NumberInput value={o.maxQty} min={0} step={1} onChange={(v) => setOutput(i, { maxQty: Math.max(v ?? 1, o.minQty) })} />
              </td>
              <td>
                <button className="icon-btn" onClick={() => set('outputs', rec.outputs.filter((_, k) => k !== i))} aria-label="Remove output">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rec.outputMode === 'exclusive' && chanceSum > 1.0001 && <p className="warn small">Chances add up to more than 100%.</p>}
      <AddItemRow label="Add output" onAdd={(id) => set('outputs', [...rec.outputs, { itemId: id, chance: 1, minQty: 1, maxQty: 1 }])} />
      <p className="small muted">
        Wowhead shows "(2)" after some created items, but it is not a count we can trust yet, so imports use quantity 1. Change it here if a recipe really
        makes more.
      </p>

      {record.rawTooltip && (
        <details className="raw">
          <summary className="small muted">Raw Wowhead tooltip</summary>
          <pre className="tooltip-text">{tooltipText(record.rawTooltip)}</pre>
        </details>
      )}
    </Panel>
  );
}

function AddItemRow({ label, onAdd }: { label: string; onAdd: (id: number) => void }) {
  const [id, setId] = useState<number | null>(null);
  return (
    <div className="add-row">
      <ItemPicker value={id} onChange={setId} />
      <button
        disabled={id === null}
        onClick={() => {
          onAdd(id!);
          setId(null);
        }}
      >
        {label}
      </button>
    </div>
  );
}
