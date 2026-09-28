import { useState } from 'react';
import { findDisenchantRule } from '../engine/disenchant';
import { expectedQty } from '../engine/items';
import { QUALITY_NAMES, type DisenchantRule, type Quality, type RecipeOutput } from '../engine/types';
import { useStore } from '../state/store';
import { fmtQty, ItemName, ItemPicker, NumberInput, Panel } from './common';

/** Manually maintained disenchant rules (REQ-3.1, DEC-2, DEC-7). */
export function DisenchantPage() {
  const { deRules, engine, mutate } = useStore();
  const [checkCount, setCheckCount] = useState<number | null>(37);

  const addRule = () =>
    mutate((repo) => repo.saveDeRule({ id: 0, quality: 2, ilvlMin: 1, ilvlMax: 10, itemClass: 'armor', outputs: [], notes: '' }));

  const matching = (rule: DisenchantRule) => [...engine.items.values()].filter((i) => findDisenchantRule(engine.deRules, i)?.id === rule.id);

  return (
    <div className="stack">
      <Panel title="Disenchant rules" actions={<button onClick={addRule}>Add rule</button>}>
        <p className="small muted">
          An item is disenchanted by the first rule that matches its quality, item level and armor or weapon type. Values are entered by hand; check them
          against DE Tracker totals with the expected yield column.
        </p>
        <label className="inline small">
          Expected yield for
          <NumberInput value={checkCount} min={1} step={1} onChange={setCheckCount} />
          disenchants
        </label>
        <div className="rules">
          {deRules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} checkCount={checkCount ?? 1} matchCount={matching(rule).length} />
          ))}
          {deRules.length === 0 && <p className="muted">No rules yet.</p>}
        </div>
      </Panel>
    </div>
  );
}

function RuleCard({ rule, checkCount, matchCount }: { rule: DisenchantRule; checkCount: number; matchCount: number }) {
  const { mutate } = useStore();
  const [newItem, setNewItem] = useState<number | null>(null);
  const save = (patch: Partial<DisenchantRule>) => mutate((repo) => repo.saveDeRule({ ...rule, ...patch }));
  const setOutput = (i: number, patch: Partial<RecipeOutput>) => save({ outputs: rule.outputs.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const chanceSum = rule.outputs.reduce((s, o) => s + o.chance, 0);

  return (
    <div className="rule-card">
      <div className="field-row">
        <label>
          Quality
          <select value={rule.quality} onChange={(e) => save({ quality: Number(e.target.value) as Quality })}>
            {QUALITY_NAMES.map((q, i) => (
              <option key={q} value={i}>
                {q}
              </option>
            ))}
          </select>
        </label>
        <label>
          Item level from
          <NumberInput value={rule.ilvlMin} min={0} step={1} onChange={(v) => save({ ilvlMin: v ?? 0 })} />
        </label>
        <label>
          to
          <NumberInput value={rule.ilvlMax} min={0} step={1} onChange={(v) => save({ ilvlMax: v ?? 0 })} />
        </label>
        <label>
          Type
          <select value={rule.itemClass} onChange={(e) => save({ itemClass: e.target.value as DisenchantRule['itemClass'] })}>
            <option value="armor">Armor</option>
            <option value="weapon">Weapon</option>
          </select>
        </label>
        <label className="grow">
          Notes
          <input value={rule.notes} onChange={(e) => save({ notes: e.target.value })} />
        </label>
        <button
          className="danger"
          onClick={() => {
            if (confirm('Delete this rule?')) mutate((repo) => repo.deleteDeRule(rule.id));
          }}
        >
          Delete
        </button>
      </div>
      <table className="form-table">
        <thead>
          <tr>
            <th>Result</th>
            <th>Chance %</th>
            <th>Min</th>
            <th>Max</th>
            <th className="r">Per {checkCount} DEs</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rule.outputs.map((o, i) => (
            <tr key={i}>
              <td>
                <ItemName id={o.itemId} />
              </td>
              <td>
                <NumberInput value={Math.round(o.chance * 10000) / 100} min={0} step={0.1} onChange={(v) => setOutput(i, { chance: Math.min(1, Math.max(0, (v ?? 0) / 100)) })} />
              </td>
              <td>
                <NumberInput value={o.minQty} min={0} step={1} onChange={(v) => setOutput(i, { minQty: v ?? 1, maxQty: Math.max(v ?? 1, o.maxQty) })} />
              </td>
              <td>
                <NumberInput value={o.maxQty} min={0} step={1} onChange={(v) => setOutput(i, { maxQty: Math.max(v ?? 1, o.minQty) })} />
              </td>
              <td className="r">{fmtQty(Math.round(expectedQty(o) * checkCount * 10) / 10)}</td>
              <td>
                <button className="icon-btn" onClick={() => save({ outputs: rule.outputs.filter((_, k) => k !== i) })} aria-label="Remove result">
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
            save({ outputs: [...rule.outputs, { itemId: newItem!, chance: 1, minQty: 1, maxQty: 1 }] });
            setNewItem(null);
          }}
        >
          Add result
        </button>
        <span className="small muted">
          {matchCount} catalog item{matchCount === 1 ? '' : 's'} match
          {Math.abs(chanceSum - 1) > 0.0001 && rule.outputs.length > 0 && <span className="warn">, chances add up to {Math.round(chanceSum * 1000) / 10}%</span>}
        </span>
      </div>
    </div>
  );
}
