import { useMemo, useState } from 'react';
import { findDisenchantRule } from '../engine/disenchant';
import type { Workflow, WorkflowStep } from '../engine/types';
import { analyzeWorkflow, describeStep, dispositionFor, resolveStep, type ExternalInput, type WorkflowAnalysis } from '../engine/workflow';
import { importItem, importRecipe } from '../state/importer';
import { useStore } from '../state/store';
import { errorText, fmtQty, formatDuration, ItemName, ItemPicker, Money, NumberInput, Panel, Segmented } from './common';
import { AhPriceAge, AhPriceCell, VendorBuyCell } from './PriceCells';

const QUICKSTART = {
  name: 'DE shuffle',
  notes: 'Linen to gloves, disenchant, dust and essence into oil and wands. Vendor the results.',
  spells: [2963, 3840, 25124, 14807],
  gloves: 4307,
  /** Coarse Thread, Maple Seed, Empty Vial, Simple Wood come from a vendor. */
  vendorBuys: [2320, 17034, 3371, 4470],
};

function newWorkflow(name: string, steps: WorkflowStep[] = [], notes = ''): Workflow {
  return {
    id: 0,
    name,
    notes,
    steps,
    unitItemId: null,
    buyMap: {},
    sellMap: {},
    batchSize: null,
    ahType: 'faction',
    ahDuration: '8h',
    updatedAt: Date.now(),
  };
}

const round3 = (n: number) => fmtQty(Math.round(n * 1000) / 1000);

export function WorkflowsPage() {
  const { workflows, engine, mutate, mutateAsync } = useStore();
  const [selectedId, setSelectedId] = useState<number | null>(workflows[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const results = useMemo(() => {
    const m = new Map<number, WorkflowAnalysis>();
    for (const wf of workflows) m.set(wf.id, analyzeWorkflow(engine, wf, { simulate: false }));
    return m;
  }, [workflows, engine]);

  const selected = workflows.find((w) => w.id === selectedId) ?? workflows[0] ?? null;

  const create = () => {
    const id = mutate((repo) => repo.saveWorkflow(newWorkflow('New workflow')));
    setSelectedId(id);
  };

  const quickstart = async () => {
    setBusy(true);
    setMsg('Importing the DE shuffle recipes from Wowhead...');
    try {
      const problems: string[] = [];
      await mutateAsync(async (repo) => {
        for (const spell of QUICKSTART.spells) {
          const r = await importRecipe(repo, spell);
          problems.push(...r.warnings.map((w) => `${r.recipe.imported.name}: ${w}`), ...r.itemErrors);
        }
        await importItem(repo, QUICKSTART.gloves);
      });
      const steps: WorkflowStep[] = [
        { type: 'recipe', recipeId: 'spell:2963' },
        { type: 'recipe', recipeId: 'spell:3840' },
        { type: 'disenchant', itemId: QUICKSTART.gloves },
        { type: 'recipe', recipeId: 'spell:25124' },
        { type: 'recipe', recipeId: 'spell:14807' },
      ];
      const wf = newWorkflow(QUICKSTART.name, steps, QUICKSTART.notes);
      wf.buyMap = Object.fromEntries(QUICKSTART.vendorBuys.map((id) => [id, 'vendor' as const]));
      const id = mutate((repo) => repo.saveWorkflow(wf));
      setSelectedId(id);
      setMsg(
        problems.length
          ? `Imported with notes: ${problems.join(' ')}`
          : 'Imported. Now enter vendor buy prices for thread, seed, vial and wood, and an AH price for linen.',
      );
    } catch (e) {
      setMsg(`Import failed: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h2>Workflows</h2>
          <button onClick={create}>New</button>
        </div>
        {workflows.length === 0 && <p className="muted small">No workflows yet.</p>}
        <ul className="wf-list">
          {workflows.map((wf) => {
            const a = results.get(wf.id)!;
            return (
              <li key={wf.id}>
                <button className={`wf-item ${selected?.id === wf.id ? 'on' : ''}`} onClick={() => setSelectedId(wf.id)}>
                  <span className="wf-name">{wf.name}</span>
                  <span className="wf-sub">
                    {a.ok ? (
                      <>
                        <Money value={a.goldPerHourCopper} signed />
                        <span className="muted">/h</span>
                      </>
                    ) : (
                      <span className="neg">needs attention</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {!workflows.some((w) => w.name === QUICKSTART.name) && (
          <div className="quickstart">
            <p className="small muted">Start from the example route in the PRD:</p>
            <button disabled={busy} onClick={quickstart}>
              {busy ? 'Importing...' : 'Import DE shuffle'}
            </button>
          </div>
        )}
        {msg && <p className="small note">{msg}</p>}
      </aside>
      <div className="main">
        {selected ? (
          <WorkflowEditor key={selected.id} wf={selected} onDeleted={() => setSelectedId(null)} />
        ) : (
          <Panel title="No workflow selected">
            <p>A workflow is a known route: ordered recipe steps, where to buy what goes in, and what to do with what comes out.</p>
            <p className="muted">Create one, or import the DE shuffle example.</p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function WorkflowEditor({ wf, onDeleted }: { wf: Workflow; onDeleted: () => void }) {
  const { engine, mutate, config } = useStore();
  const analysis = useMemo(() => analyzeWorkflow(engine, wf), [engine, wf]);
  const save = (patch: Partial<Workflow>) => mutate((repo) => repo.saveWorkflow({ ...wf, ...patch, updatedAt: Date.now() }));

  const resolved = wf.steps.map((s) => resolveStep(engine, s));
  const madeIds = new Set(resolved.flatMap((r) => r?.outputs.map((o) => o.itemId) ?? []));
  const baseIds = new Set(resolved.flatMap((r) => r?.inputs.map((i) => i.itemId) ?? []).filter((id) => !madeIds.has(id)));
  const itemLabel = (id: number) => engine.items.get(id)?.name ?? `#${id}`;
  const byName = (a: number, b: number) => itemLabel(a).localeCompare(itemLabel(b));

  const moveStep = (i: number, d: -1 | 1) => {
    const steps = [...wf.steps];
    [steps[i], steps[i + d]] = [steps[i + d], steps[i]];
    save({ steps });
  };

  return (
    <div className="stack">
      <Panel
        title={<input className="title-input" value={wf.name} onChange={(e) => save({ name: e.target.value })} aria-label="Workflow name" />}
        actions={
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete workflow "${wf.name}"?`)) {
                mutate((repo) => repo.deleteWorkflow(wf.id));
                onDeleted();
              }
            }}
          >
            Delete
          </button>
        }
      >
        <textarea className="notes" placeholder="Notes" value={wf.notes} onChange={(e) => save({ notes: e.target.value })} rows={2} />
        <div className="field-row">
          <label>
            Per unit of
            <select value={wf.unitItemId ?? ''} onChange={(e) => save({ unitItemId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">
                Default
                {analysis.unitItemId && !wf.unitItemId ? ` (${engine.items.get(analysis.unitItemId)?.name ?? `#${analysis.unitItemId}`})` : ''}
              </option>
              <optgroup label="Made">
                {[...madeIds].sort(byName).map((id) => (
                  <option key={id} value={id}>
                    {itemLabel(id)}
                  </option>
                ))}
              </optgroup>
              {baseIds.size > 0 && (
                <optgroup label="Base materials">
                  {[...baseIds].sort(byName).map((id) => (
                    <option key={id} value={id}>
                      {itemLabel(id)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label>
            Batch size
            <NumberInput value={wf.batchSize} placeholder={String(config.defaultBatchSize)} min={1} step={1} onChange={(v) => save({ batchSize: v })} />
          </label>
          <label>
            AH
            <Segmented
              value={wf.ahType}
              options={[
                { value: 'faction', label: 'Faction' },
                { value: 'neutral', label: 'Neutral' },
              ]}
              onChange={(ahType) => save({ ahType })}
            />
          </label>
        </div>
      </Panel>

      <Results analysis={analysis} />

      <Panel title="Steps">
        <ol className="steps">
          {wf.steps.map((step, i) => {
            const r = resolved[i];
            const sa = analysis.steps[i];
            return (
              <li key={i} className={r ? '' : 'broken'}>
                <div className="step-main">
                  <span className="step-name">{describeStep(engine, step)}</span>
                  {r && (
                    <span className="step-io small">
                      {r.inputs.map((x, k) => (
                        <span key={k}>
                          {k > 0 && ' + '}
                          {x.qty} <ItemName id={x.itemId} />
                        </span>
                      ))}
                      <span className="arrow"> into </span>
                      {r.outputs.map((o, k) => (
                        <span key={k}>
                          {k > 0 && (r.outputMode === 'exclusive' ? ' or ' : ' + ')}
                          {o.minQty === o.maxQty ? o.minQty : `${o.minQty}-${o.maxQty}`} <ItemName id={o.itemId} />
                          {o.chance < 1 && <span className="muted"> ({Math.round(o.chance * 1000) / 10}%)</span>}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div className="step-side">
                  {sa && (
                    <span className="runs" title="Runs per unit">
                      x{round3(sa.runsPerUnit)}
                    </span>
                  )}
                  <button className="icon-btn" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button className="icon-btn" disabled={i === wf.steps.length - 1} onClick={() => moveStep(i, 1)} aria-label="Move down">
                    ↓
                  </button>
                  <button className="icon-btn" onClick={() => save({ steps: wf.steps.filter((_, k) => k !== i) })} aria-label="Remove step">
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <AddStep onAdd={(step) => save({ steps: [...wf.steps, step] })} />
      </Panel>

      {analysis.ok && (
        <div className="grid2">
          <Panel title="Buy (per unit)">
            {(['ah', 'vendor'] as const).map((source) => (
              <BuySection
                key={source}
                source={source}
                inputs={analysis.externalInputs.filter((x) => x.source === source)}
                batchSize={analysis.batchSize}
                onMove={(itemId) => save({ buyMap: { ...wf.buyMap, [itemId]: source === 'ah' ? 'vendor' : 'ah' } })}
              />
            ))}
          </Panel>
          <Panel title="Sell (per unit)">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">Qty</th>
                  <th>To</th>
                  <th>Price</th>
                  <th className="r">Value</th>
                </tr>
              </thead>
              <tbody>
                {analysis.terminalOutputs.map((x) => (
                  <tr key={x.itemId}>
                    <td>
                      <ItemName id={x.itemId} />
                    </td>
                    <td className="r">{round3(x.qtyPerUnit)}</td>
                    <td>
                      <Segmented
                        value={dispositionFor(engine, wf, x.itemId)}
                        options={[
                          { value: 'ah', label: 'AH' },
                          { value: 'vendor', label: 'Vendor' },
                          { value: 'keep', label: 'Keep' },
                        ]}
                        onChange={(v) => save({ sellMap: { ...wf.sellMap, [x.itemId]: v } })}
                      />
                    </td>
                    <td>
                      {x.disposition === 'ah' ? (
                        <div className="price-cell">
                          <AhPriceCell itemId={x.itemId} />
                          <AhPriceCell itemId={x.itemId} pessimistic />
                          <AhPriceAge itemId={x.itemId} />
                        </div>
                      ) : x.disposition === 'vendor' ? (
                        <Money value={engine.items.get(x.itemId)?.vendorSell ?? null} />
                      ) : (
                        <span className="muted">not counted</span>
                      )}
                    </td>
                    <td className="r">
                      <Money value={x.valuePerUnit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analysis.terminalOutputs.some((x) => x.disposition === 'ah') && (
              <p className="small muted">
                AH value is after the {Math.round(config.ahCut[wf.ahType] * 100)}% cut. The second price is the optional pessimistic price used for the
                worst case.
              </p>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function BuySection({
  source,
  inputs,
  batchSize,
  onMove,
}: {
  source: 'ah' | 'vendor';
  inputs: ExternalInput[];
  batchSize: number;
  onMove: (itemId: number) => void;
}) {
  const total = inputs.reduce((sum, x) => sum + x.costPerUnit, 0);
  return (
    <section className="buy-section">
      <h3 className="buy-section-head">
        <span>{source === 'ah' ? 'Auction House' : 'Vendor'}</span>
        <Money value={total} />
      </h3>
      {inputs.length === 0 ? (
        <p className="small muted">Nothing to buy here.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Qty</th>
              <th className="r" title="Quantity for the whole batch, rounded up">
                Batch
              </th>
              <th>Price</th>
              <th className="r">Cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {inputs.map((x) => (
              <tr key={x.itemId}>
                <td>
                  <ItemName id={x.itemId} />
                </td>
                <td className="r">{round3(x.qtyPerUnit)}</td>
                <td className="r">{fmtQty(Math.ceil(x.qtyPerUnit * batchSize - 1e-6))}</td>
                <td>
                  {source === 'ah' ? (
                    <div className="price-cell">
                      <AhPriceCell itemId={x.itemId} />
                      <AhPriceAge itemId={x.itemId} />
                    </div>
                  ) : (
                    <VendorBuyCell itemId={x.itemId} />
                  )}
                </td>
                <td className="r">
                  <Money value={x.costPerUnit} />
                </td>
                <td className="r">
                  <button className="icon-btn nowrap" onClick={() => onMove(x.itemId)} title={`Buy from ${source === 'ah' ? 'a vendor' : 'the AH'} instead`}>
                    {source === 'ah' ? 'To vendor' : 'To AH'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Results({ analysis: a }: { analysis: WorkflowAnalysis }) {
  if (!a.ok) {
    return (
      <Panel className="results error-panel">
        {a.errors.map((e, i) => (
          <p key={i}>{e}</p>
        ))}
      </Panel>
    );
  }
  const sim = a.simulation;
  return (
    <Panel className="results">
      <div className="kpis">
        {sim?.deterministic ? (
          <>
            <div className="kpi kpi-worst">
              <span className="kpi-label">Batch profit, batch of {a.batchSize}</span>
              <span className="kpi-value">
                <Money value={sim.p50} signed />
              </span>
              <span className="kpi-sub">no chance-based outputs, so no simulation needed</span>
            </div>
            {sim.worstCase !== sim.p50 && (
              <div className="kpi">
                <span className="kpi-label">With pessimistic AH prices</span>
                <span className="kpi-value">
                  <Money value={sim.worstCase} signed />
                </span>
                <span className="kpi-sub">same batch, pessimistic sell prices</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="kpi kpi-worst">
              <span className="kpi-label">Worst case, batch of {a.batchSize}</span>
              <span className="kpi-value">
                <Money value={sim?.worstCase ?? null} signed />
              </span>
              <span className="kpi-sub">95% of batches do at least this well</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Batch P5 / median / P95</span>
              <span className="kpi-value range">
                <Money value={sim?.p5} signed /> <span className="muted">/</span> <Money value={sim?.p50} signed /> <span className="muted">/</span>{' '}
                <Money value={sim?.p95} signed />
              </span>
              <span className="kpi-sub">{sim ? `${sim.runs.toLocaleString()} simulated batches` : ''}</span>
            </div>
          </>
        )}
        <div className="kpi">
          <span className="kpi-label">Gold per hour</span>
          <span className="kpi-value">
            <Money value={a.goldPerHourCopper} signed />
          </span>
          <span className="kpi-sub">batch takes {formatDuration(a.batchTimeSec)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Profit per unit (EV)</span>
          <span className="kpi-value">
            <Money value={a.profitPerUnit} signed />
          </span>
          <span className="kpi-sub">
            sells for <Money value={a.revenuePerUnit} />, costs <Money value={a.costPerUnit} />, takes {formatDuration(a.timePerUnitSec)}
          </span>
        </div>
      </div>
      <div className="result-notes small">
        {a.tools.length > 0 && (
          <p>
            Tools needed:{' '}
            {a.tools.map((t, i) => (
              <span key={t}>
                {i > 0 && ', '}
                <ItemName id={t} />
              </span>
            ))}
          </p>
        )}
        {sim && sim.leftovers.length > 0 && (
          <p>
            {sim.deterministic ? 'Leftovers per batch:' : 'Typical leftovers per batch:'}{' '}
            {sim.leftovers.map((l, i) => (
              <span key={l.itemId}>
                {i > 0 && ', '}
                {fmtQty(Math.round(l.avgQty * 10) / 10)} <ItemName id={l.itemId} />
              </span>
            ))}
          </p>
        )}
        {a.missingPrices.length > 0 && (
          <p className="warn">
            Missing:{' '}
            {a.missingPrices.map((m, i) => (
              <span key={`${m.itemId}-${m.what}`}>
                {i > 0 && ', '}
                {m.what} for <ItemName id={m.itemId} />
              </span>
            ))}
            . Counted as 0.
          </p>
        )}
        {a.warnings
          .filter((w) => !w.startsWith('Some prices'))
          .map((w) => (
            <p key={w} className="muted">
              {w}
            </p>
          ))}
      </div>
    </Panel>
  );
}

function AddStep({ onAdd }: { onAdd: (step: WorkflowStep) => void }) {
  const { engine, recipeRecords, mutateAsync } = useStore();
  const [mode, setMode] = useState<'recipe' | 'disenchant'>('recipe');
  const [recipeId, setRecipeId] = useState('');
  const [deItem, setDeItem] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const recipes = recipeRecords.map((r) => engine.recipes.get(r.id)!).sort((a, b) => a.name.localeCompare(b.name));

  const add = async () => {
    setErr(null);
    if (mode === 'recipe') {
      if (!recipeId) return;
      onAdd({ type: 'recipe', recipeId });
      setRecipeId('');
    } else {
      if (deItem === null) return;
      if (!engine.items.has(deItem)) {
        try {
          await mutateAsync((repo) => importItem(repo, deItem));
        } catch (e) {
          return setErr(errorText(e));
        }
      }
      onAdd({ type: 'disenchant', itemId: deItem });
      setDeItem(null);
    }
  };

  const deItemObj = deItem !== null ? engine.items.get(deItem) : undefined;
  const noRule = deItemObj && !findDisenchantRule(engine.deRules, deItemObj);

  return (
    <div className="add-step">
      <Segmented
        value={mode}
        options={[
          { value: 'recipe', label: 'Recipe' },
          { value: 'disenchant', label: 'Disenchant' },
        ]}
        onChange={setMode}
      />
      {mode === 'recipe' ? (
        <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
          <option value="">{recipes.length ? 'Choose a recipe...' : 'No recipes yet, import some first'}</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.kind})
            </option>
          ))}
        </select>
      ) : (
        <ItemPicker
          value={deItem}
          onChange={setDeItem}
          filter={(i) => i.itemClass === 'armor' || i.itemClass === 'weapon'}
          placeholder="Item to disenchant"
        />
      )}
      <button onClick={add}>Add step</button>
      {noRule && <span className="small warn">No disenchant rule matches this item yet.</span>}
      {err && <span className="small warn">{err}</span>}
    </div>
  );
}
