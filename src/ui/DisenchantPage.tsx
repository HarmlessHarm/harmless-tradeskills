import { Fragment, useRef, useState } from 'react';
import { findDisenchantRule } from '../engine/disenchant';
import { expectedQty } from '../engine/items';
import { QUALITY_NAMES, type DisenchantRule, type Quality, type RecipeOutput } from '../engine/types';
import { useStore } from '../state/store';
import { fmtQty, ItemName, ItemPicker, NumberInput, Panel } from './common';
import { RowActions } from './Selection';
import { SortHeader, sortRows, useSort, type SortValue } from './sorting';

/** Poor and Common items cannot be disenchanted. */
const MIN_DE_QUALITY = 2;
const COLS = 6;
const ALL = '__all';
type RuleSortKey = 'quality' | 'min' | 'max' | 'type';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const qtyText = (o: RecipeOutput) => (o.minQty === o.maxQty ? String(o.minQty) : `${o.minQty}-${o.maxQty}`);
/** Chances are shown as decimals: 75% is 0.75. */
const chanceText = (c: number) => String(Math.round(c * 10000) / 10000);

/** Manually maintained disenchant rules (REQ-3.1, DEC-2, DEC-7). */
export function DisenchantPage() {
  const { deRules, mutate } = useStore();
  const sort = useSort<RuleSortKey>('quality');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<DisenchantRule | null>(null);
  // An input's blur may update the draft in the same click as Save, so save reads the ref.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [qualityFilter, setQualityFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [levelFrom, setLevelFrom] = useState<number | null>(null);
  const [levelTo, setLevelTo] = useState<number | null>(null);
  const filtering = qualityFilter !== ALL || typeFilter !== ALL || levelFrom !== null || levelTo !== null;
  const clearFilters = () => {
    setQualityFilter(ALL);
    setTypeFilter(ALL);
    setLevelFrom(null);
    setLevelTo(null);
  };

  const stored = editing === null ? undefined : deRules.find((r) => r.id === editing);
  const dirty = !!stored && !!draft && !same(stored, draft);

  const close = () => {
    setEditing(null);
    setDraft(null);
  };
  const open = (rule: DisenchantRule) => {
    if (rule.id === editing) return;
    if (dirty && !confirm('Discard your unsaved changes?')) return;
    setEditing(rule.id);
    setDraft(rule);
  };
  const save = () => {
    if (draftRef.current) mutate((repo) => repo.saveDeRule(draftRef.current!));
    close();
  };
  const update = (patch: Partial<DisenchantRule>) => {
    if (!draftRef.current) return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
  };
  const remove = (rule: DisenchantRule) => {
    if (!confirm(`Delete the ${QUALITY_NAMES[rule.quality]} ${rule.itemClass} rule for item level ${rule.ilvlMin}-${rule.ilvlMax}?`)) return;
    mutate((repo) => repo.deleteDeRule(rule.id));
    if (editing === rule.id) close();
  };
  const addRule = () => {
    if (dirty && !confirm('Discard your unsaved changes?')) return;
    const rule: DisenchantRule = { id: 0, quality: 2, ilvlMin: 1, ilvlMax: 10, itemClass: 'armor', outputs: [], notes: '' };
    const id = mutate((repo) => repo.saveDeRule(rule));
    clearFilters();
    setEditing(id);
    setDraft({ ...rule, id });
  };

  // The level filter keeps rules whose band overlaps it; the same level in both finds the rule for that level.
  const filtered = deRules.filter(
    (r) =>
      (qualityFilter === ALL || r.quality === Number(qualityFilter)) &&
      (typeFilter === ALL || r.itemClass === typeFilter) &&
      (levelFrom === null || r.ilvlMax >= levelFrom) &&
      (levelTo === null || r.ilvlMin <= levelTo),
  );
  const rows = sortRows(
    filtered,
    sort,
    (r, key): SortValue => {
      switch (key) {
        case 'quality':
          return r.quality;
        case 'min':
          return r.ilvlMin;
        case 'max':
          return r.ilvlMax;
        case 'type':
          return r.itemClass;
      }
    },
    // Ties: armor before weapons, then by level, as the rules are listed in game.
    (r) => `${r.itemClass} ${String(r.ilvlMin).padStart(4, '0')}`,
  );

  return (
    <div className="stack">
      <Panel title={`Disenchant rules (${filtering ? `${rows.length} of ${deRules.length}` : deRules.length})`} actions={<button onClick={addRule}>Add rule</button>}>
        <p className="small muted">
          An item is disenchanted by the first rule that matches its quality, item level and armor or weapon type. Each disenchant gives exactly one
          result, picked by its chance. Check the values against DE Tracker totals with the expected yield in the editor.
        </p>
        <div className="table-filters">
          <select
            className={qualityFilter === ALL ? '' : `q${qualityFilter}`}
            value={qualityFilter}
            onChange={(e) => setQualityFilter(e.target.value)}
            aria-label="Filter by quality"
          >
            <option value={ALL}>All qualities</option>
            {QUALITY_NAMES.map((q, i) =>
              i >= MIN_DE_QUALITY ? (
                <option key={q} value={i} className={`q${i}`}>
                  {q}
                </option>
              ) : null,
            )}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
            <option value={ALL}>Armor and weapons</option>
            <option value="armor">Armor</option>
            <option value="weapon">Weapon</option>
          </select>
          <label className="inline small">
            iLvl
            <LevelInput value={levelFrom} placeholder="min" label="Minimum item level" onChange={setLevelFrom} />
            to
            <LevelInput value={levelTo} placeholder="max" label="Maximum item level" onChange={setLevelTo} />
          </label>
          {filtering && (
            <button className="link-btn" onClick={clearFilters}>
              clear filters
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="Quality" k="quality" sort={sort} className="tight" />
                <SortHeader label="Min iLvl" k="min" sort={sort} className="r tight" />
                <SortHeader label="Max iLvl" k="max" sort={sort} className="r tight" />
                <SortHeader label="Type" k="type" sort={sort} className="tight" />
                <th>Results</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((rule) => (
                <Fragment key={rule.id}>
                  <tr className={editing === rule.id ? 'editing' : ''}>
                    <td className={`tight q${rule.quality}`}>{QUALITY_NAMES[rule.quality]}</td>
                    <td className="r tight">{rule.ilvlMin}</td>
                    <td className="r tight">{rule.ilvlMax}</td>
                    <td className="small tight">{rule.itemClass === 'armor' ? 'Armor' : 'Weapon'}</td>
                    <td className="small">
                      {rule.outputs.map((o, k) => (
                        <div key={k}>
                          {qtyText(o)} <ItemName id={o.itemId} /> <span className="muted">{chanceText(o.chance)}</span>
                        </div>
                      ))}
                      {rule.outputs.length === 0 && <span className="warn">none</span>}
                    </td>
                    <td className="actions">
                      <RowActions
                        name={`${QUALITY_NAMES[rule.quality]} ${rule.itemClass} ${rule.ilvlMin}-${rule.ilvlMax}`}
                        editing={editing === rule.id}
                        dirty={editing === rule.id && dirty}
                        onEdit={() => open(rule)}
                        onSave={save}
                        onDelete={() => remove(rule)}
                      />
                    </td>
                  </tr>
                  {editing === rule.id && draft && (
                    <tr className="editor-row">
                      <td colSpan={COLS}>
                        <RuleEditor rule={draft} dirty={dirty} update={update} onSave={save} onCancel={close} onDelete={() => remove(rule)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLS} className="muted">
                    {deRules.length ? 'No rules match these filters.' : 'No rules yet.'}
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

/** Filters as you type, unlike NumberInput which commits on blur. */
function LevelInput({ value, placeholder, label, onChange }: { value: number | null; placeholder: string; label: string; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number"
      className="num-input short"
      min={0}
      step={1}
      placeholder={placeholder}
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value.trim() === '' ? null : Number(e.target.value);
        onChange(v === null || Number.isFinite(v) ? v : null);
      }}
    />
  );
}

function RuleEditor({
  rule,
  dirty,
  update,
  onSave,
  onCancel,
  onDelete,
}: {
  rule: DisenchantRule;
  dirty: boolean;
  update: (patch: Partial<DisenchantRule>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { engine } = useStore();
  const [checkCount, setCheckCount] = useState<number | null>(100);
  const [newItem, setNewItem] = useState<number | null>(null);
  const count = checkCount ?? 1;
  const setOutput = (i: number, patch: Partial<RecipeOutput>) => update({ outputs: rule.outputs.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const chanceSum = rule.outputs.reduce((s, o) => s + o.chance, 0);
  // Matches use the saved rules, so this count reflects the rule as stored until you save.
  const matchCount = [...engine.items.values()].filter((i) => findDisenchantRule(engine.deRules, i)?.id === rule.id).length;

  return (
    <Panel
      title={`Edit ${QUALITY_NAMES[rule.quality]} ${rule.itemClass} rule`}
      actions={
        <>
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
      <div className="field-row">
        <label>
          Quality
          <select className={`q${rule.quality}`} value={rule.quality} onChange={(e) => update({ quality: Number(e.target.value) as Quality })}>
            {QUALITY_NAMES.map((q, i) =>
              i >= MIN_DE_QUALITY || i === rule.quality ? (
                <option key={q} value={i} className={`q${i}`}>
                  {q}
                </option>
              ) : null,
            )}
          </select>
        </label>
        <label>
          Min iLvl
          <NumberInput value={rule.ilvlMin} min={0} step={1} onChange={(v) => update({ ilvlMin: v ?? 0 })} />
        </label>
        <label>
          Max iLvl
          <NumberInput value={rule.ilvlMax} min={0} step={1} onChange={(v) => update({ ilvlMax: v ?? 0 })} />
        </label>
        <label>
          Type
          <select value={rule.itemClass} onChange={(e) => update({ itemClass: e.target.value as DisenchantRule['itemClass'] })}>
            <option value="armor">Armor</option>
            <option value="weapon">Weapon</option>
          </select>
        </label>
        <label className="grow">
          Notes
          <input value={rule.notes} onChange={(e) => update({ notes: e.target.value })} />
        </label>
      </div>

      <h3>Results</h3>
      <label className="inline small">
        Expected yield for
        <NumberInput value={checkCount} min={1} step={1} onChange={setCheckCount} />
        disenchants
      </label>
      <table className="form-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Chance</th>
            <th>Min</th>
            <th>Max</th>
            <th className="r">Per {count} DEs</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rule.outputs.map((o, i) => (
            <tr key={i}>
              <td>
                <ItemPicker value={o.itemId} onChange={(id) => id !== null && setOutput(i, { itemId: id })} />
              </td>
              <td>
                <NumberInput value={Math.round(o.chance * 10000) / 10000} min={0} step={0.01} onChange={(v) => setOutput(i, { chance: Math.min(1, Math.max(0, v ?? 0)) })} />
              </td>
              <td>
                <NumberInput value={o.minQty} min={0} step={1} onChange={(v) => setOutput(i, { minQty: v ?? 1, maxQty: Math.max(v ?? 1, o.maxQty) })} />
              </td>
              <td>
                <NumberInput value={o.maxQty} min={0} step={1} onChange={(v) => setOutput(i, { maxQty: Math.max(v ?? 1, o.minQty) })} />
              </td>
              <td className="r">{fmtQty(Math.round(expectedQty(o) * count * 10) / 10)}</td>
              <td>
                <button className="icon-btn" onClick={() => update({ outputs: rule.outputs.filter((_, k) => k !== i) })} aria-label="Remove result">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="add-row">
        <ItemPicker value={newItem} onChange={setNewItem} placeholder="Result item name or ID" />
        <button
          disabled={newItem === null}
          onClick={() => {
            update({ outputs: [...rule.outputs, { itemId: newItem!, chance: rule.outputs.length ? Math.max(0, 1 - chanceSum) : 1, minQty: 1, maxQty: 1 }] });
            setNewItem(null);
          }}
        >
          Add result
        </button>
        <span className="small muted">
          {matchCount} catalog item{matchCount === 1 ? '' : 's'} match
          {Math.abs(chanceSum - 1) > 0.0001 && rule.outputs.length > 0 && <span className="warn">, chances add up to {chanceText(chanceSum)} instead of 1</span>}
        </span>
      </div>
    </Panel>
  );
}
