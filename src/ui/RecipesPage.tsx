import { Fragment, useState } from 'react';
import { effectiveRecipe } from '../engine/items';
import { firstTier, type Recipe, type RecipeFields, type RecipeOutput, type RecipeRecord, type RecipeSource } from '../engine/types';
import { learnedFromText, professionOptions, SOURCE_LABELS } from '../professions';
import { SkillLevels } from './skill';
import { importRecipe } from '../state/importer';
import { useStore } from '../state/store';
import { tooltipText, wowheadUrl } from '../wowhead/adapter';
import { ago, errorText, ItemName, ItemPicker, NumberInput, Panel } from './common';
import { deleteConfirmText, recipeUsage } from '../state/usage';
import { BulkImport } from './BulkImport';
import { RowActions, RowCheckbox, SelectAll, SelectionBar, useSelection } from './Selection';
import { useEditSession } from './useEditSession';
import { ImportBox } from './ItemsPage';
import { SortHeader, sortRows, useSort, type SortValue } from './sorting';

const KINDS = ['craft', 'disenchant', 'convert'];
const ALL = '__all';
const NONE = '__none';
type RecipeSortKey = 'name' | 'profession' | 'kind' | 'cast' | 'ilvl' | 'learned' | 'skill';

export function RecipesPage() {
  const { recipeRecords, mutate, engine, workflows, deRules } = useStore();
  const edit = useEditSession(recipeRecords, (r) => r.id, (r) => mutate((repo) => repo.saveRecipe(r)));
  const editing = edit.editing;
  const sel = useSelection<string>();
  const [search, setSearch] = useState('');
  const [profFilter, setProfFilter] = useState<string>(ALL);
  const [bulk, setBulk] = useState(false);
  const sort = useSort<RecipeSortKey>('name');

  const itemName = (id: number) => engine.items.get(id)?.name.toLowerCase() ?? '';
  const createdLevel = (rec: Recipe) => {
    const id = rec.outputs[0]?.itemId;
    return id === undefined ? null : (engine.items.get(id)?.itemLevel ?? null);
  };
  const all = recipeRecords.map((r) => ({ r, rec: effectiveRecipe(r) }));
  const usedProfessions = [...new Set(all.map(({ rec }) => rec.profession).filter((p): p is string => !!p))].sort();
  const hasUnassigned = all.some(({ rec }) => !rec.profession);

  // Search matches the recipe name, its reagents' names and the created item's name.
  const q = search.trim().toLowerCase();
  const matches = (rec: Recipe) =>
    !q ||
    rec.name.toLowerCase().includes(q) ||
    rec.inputs.some((i) => itemName(i.itemId).includes(q)) ||
    rec.outputs.some((o) => itemName(o.itemId).includes(q));
  const filtered = all
    .filter(({ rec }) => matches(rec))
    .filter(({ rec }) => profFilter === ALL || (profFilter === NONE ? !rec.profession : rec.profession === profFilter));
  const rows = sortRows(
    filtered,
    sort,
    ({ rec }, key): SortValue => {
      switch (key) {
        case 'name':
          return rec.name;
        case 'profession':
          return rec.profession;
        case 'kind':
          return rec.kind;
        case 'cast':
          return rec.castTimeMs;
        case 'ilvl':
          return createdLevel(rec);
        case 'learned':
          return rec.learnedFrom.length ? learnedFromText(rec.learnedFrom) : null;
        case 'skill':
          return rec.requiredSkill;
      }
    },
    ({ rec }) => rec.name,
  );
  const visibleKeys = rows.map(({ r }) => r.id);
  const filtering = q !== '' || profFilter !== ALL;

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
        imported: { name: 'New recipe', kind: 'craft', profession: null, castTimeMs: 0, inputs: [], tools: [], outputs: [], outputMode: 'independent', requiredSkill: null, learnedFrom: [], skillRange: null },
        overrides: {},
        source: 'manual',
        fetchedAt: null,
        updatedAt: now,
        rawTooltip: null,
      });
      return id;
    });
    setSearch('');
    setProfFilter(ALL);
    edit.open(id);
  };

  return (
    <div className="stack">
      <Panel
        title="Import recipes"
        actions={
          <>
            {!bulk && <button onClick={() => setBulk(true)}>Bulk import</button>}
            <button onClick={createManual}>New by hand</button>
          </>
        }
      >
        <ImportBox defaultType="spell" />
        {bulk && <BulkImport onClose={() => setBulk(false)} />}
        <p className="small muted">
          Disenchanting needs no recipe here: add a Disenchant step to a workflow and the matching disenchant rule is used.
        </p>
      </Panel>
      <Panel title={`Recipes (${filtering ? `${rows.length} of ${recipeRecords.length}` : recipeRecords.length})`}>
        <div className="table-filters">
          <input
            type="search"
            className="search wide"
            placeholder="Search recipe, reagent or created item"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search recipes"
          />
          <select value={profFilter} onChange={(e) => setProfFilter(e.target.value)} aria-label="Filter by profession">
            <option value={ALL}>All professions</option>
            {usedProfessions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {hasUnassigned && <option value={NONE}>No profession set</option>}
          </select>
          {filtering && (
            <button
              className="link-btn"
              onClick={() => {
                setSearch('');
                setProfFilter(ALL);
              }}
            >
              clear filters
            </button>
          )}
        </div>
        <SelectionBar
          count={sel.selected.size}
          onDelete={() => remove([...sel.selected])}
          onClear={sel.clear}
        />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="check">
                  <SelectAll keys={visibleKeys} sel={sel} />
                </th>
                <SortHeader label="Recipe" k="name" sort={sort} />
                <SortHeader label="Profession" k="profession" sort={sort} />
                <SortHeader label="Kind" k="kind" sort={sort} />
                <SortHeader label="Cast" k="cast" sort={sort} className="r" />
                <SortHeader label="iLvl" k="ilvl" sort={sort} className="r" />
                <SortHeader label="Learned from" k="learned" sort={sort} />
                <SortHeader label="Skill" k="skill" sort={sort} className="r" />
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
                    <RowCheckbox k={r.id} label={`Select ${rec.name}`} visibleKeys={visibleKeys} sel={sel} />
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
                  <td className="small">{rec.profession ?? <span className="muted">-</span>}</td>
                  <td className="small">{rec.kind}</td>
                  <td className="r small">{rec.castTimeMs / 1000}s</td>
                  <td className="r" title="Item level of the created item">
                    {createdLevel(rec) ?? <span className="muted">-</span>}
                  </td>
                  <td className="small">{rec.learnedFrom.length ? learnedFromText(rec.learnedFrom) : <span className="muted">-</span>}</td>
                  <td className="r small">
                    {rec.requiredSkill ?? <span className="muted">-</span>}
                    {rec.skillRange && (
                      <div>
                        <SkillLevels range={rec.skillRange} />
                      </div>
                    )}
                  </td>
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
                    <td colSpan={12}>
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
                  <td colSpan={12} className="muted">
                    {recipeRecords.length ? 'No recipes match these filters.' : 'No recipes yet. Paste a Wowhead spell link above.'}
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
  const { mutateAsync, engine } = useStore();
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
          <input list="recipe-professions" value={rec.profession ?? ''} onChange={(e) => set('profession', e.target.value || null)} />
          <datalist id="recipe-professions">
            {professionOptions([...engine.recipes.values()].map((r) => r.profession)).map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label>
          Cast time (s)
          <NumberInput value={rec.castTimeMs / 1000} step={0.001} min={0} onChange={(v) => set('castTimeMs', Math.round((v ?? 0) * 1000))} />
        </label>
      </div>

      <h3>Learning</h3>
      <div className="field-row">
        <fieldset className="inline-set">
          <legend className="small muted">Learned from</legend>
          {(Object.keys(SOURCE_LABELS) as RecipeSource[]).map((src) => (
            <label key={src} className="inline small">
              <input
                type="checkbox"
                checked={rec.learnedFrom.includes(src)}
                onChange={(e) =>
                  set(
                    'learnedFrom',
                    (Object.keys(SOURCE_LABELS) as RecipeSource[]).filter((s) => (s === src ? e.target.checked : rec.learnedFrom.includes(s))),
                  )
                }
              />
              {SOURCE_LABELS[src]}
            </label>
          ))}
        </fieldset>
        <label>
          Required skill
          <NumberInput value={rec.requiredSkill} min={0} step={1} onChange={(v) => set('requiredSkill', v)} />
        </label>
        {(['orange', 'yellow', 'green', 'grey'] as const).map((tier) => (
          <label key={tier}>
            <span className={`skill-${tier}`}>{tier[0].toUpperCase() + tier.slice(1)} from</span>
            <NumberInput
              value={rec.skillRange?.[tier] ?? null}
              min={0}
              step={1}
              onChange={(v) => {
                const next = { ...(rec.skillRange ?? { orange: null, yellow: null, green: null, grey: null }), [tier]: v };
                set('skillRange', firstTier(next) === null ? null : next);
              }}
            />
          </label>
        ))}
      </div>
      <p className="small muted">A recipe learned from a trainer counts as known by every character with enough skill. Leave a color empty when the recipe does not show it on Wowhead.</p>

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
