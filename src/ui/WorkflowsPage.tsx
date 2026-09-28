import { useMemo, useState } from 'react';
import { anyItemId, findDisenchantRule } from '../engine/disenchant';
import { QUALITY_NAMES, type AhType, type Item, type Quality, type Recipe, type Workflow, type WorkflowStep } from '../engine/types';
import {
  analyzeWorkflow,
  describeStep,
  dispositionFor,
  insertBeforeConsumer,
  itemFor,
  producersOf,
  resolveStep,
  type BuyLimit,
  type ExternalInput,
  type WorkflowAnalysis,
} from '../engine/workflow';
import { importItem, importRecipe } from '../state/importer';
import { useStore } from '../state/store';
import { Combo, errorText, fmtQty, formatDuration, ItemIcon, ItemName, Money, MoneyInput, NumberInput, Panel, Segmented } from './common';
import { AhMinCell, AhPriceAge, AhPriceCell, VendorBuyCell } from './PriceCells';
import { searchRecipes } from './recipeSearch';

/** Coarse Thread, Maple Seed, Empty Vial, Simple Wood come from a vendor. */
const VENDOR_BUYS = [2320, 17034, 3371, 4470];
const OIL_AND_WANDS: WorkflowStep[] = [
  { type: 'recipe', recipeId: 'spell:25124' },
  { type: 'recipe', recipeId: 'spell:14807' },
];

const QUICKSTARTS = [
  {
    name: 'DE shuffle',
    button: 'Import DE shuffle',
    notes: 'Linen to gloves, disenchant, dust and essence into oil and wands. Vendor the results.',
    spells: [2963, 3840, 25124, 14807],
    items: [4307],
    steps: [
      { type: 'recipe', recipeId: 'spell:2963' },
      { type: 'recipe', recipeId: 'spell:3840' },
      { type: 'disenchant', itemId: 4307 },
      ...OIL_AND_WANDS,
    ] as WorkflowStep[],
    done: 'Imported. Now enter vendor buy prices for thread, seed, vial and wood, and an AH price for linen.',
  },
  {
    name: 'Buy greens to DE',
    button: 'Import buy price calculator',
    notes: 'Buy any uncommon armor up to item level 15, disenchant it, turn dust and essence into oil and wands. What can I pay per item?',
    spells: [25124, 14807],
    items: [],
    steps: [{ type: 'disenchant-any', quality: 2, itemClass: 'armor', itemLevel: 15 }, ...OIL_AND_WANDS] as WorkflowStep[],
    done: 'Imported. Now enter vendor buy prices for seed, vial and wood, and set a target gold per hour.',
  },
];

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
    targetGoldPerHour: null,
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

  const quickstart = async (qs: (typeof QUICKSTARTS)[number]) => {
    setBusy(true);
    setMsg(`Importing the ${qs.name} recipes from Wowhead...`);
    try {
      const problems: string[] = [];
      await mutateAsync(async (repo) => {
        for (const spell of qs.spells) {
          const r = await importRecipe(repo, spell);
          problems.push(...r.warnings.map((w) => `${r.recipe.imported.name}: ${w}`), ...r.itemErrors);
        }
        for (const item of qs.items) await importItem(repo, item);
      });
      const wf = newWorkflow(qs.name, qs.steps, qs.notes);
      wf.buyMap = Object.fromEntries(VENDOR_BUYS.map((id) => [id, 'vendor' as const]));
      const id = mutate((repo) => repo.saveWorkflow(wf));
      setSelectedId(id);
      setMsg(problems.length ? `Imported with notes: ${problems.join(' ')}` : qs.done);
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
                    {a.ok && a.buyLimit ? (
                      <>
                        <span className="muted">pay up to </span>
                        <Money value={a.buyLimit.breakEven} signed />
                      </>
                    ) : a.ok ? (
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
        {QUICKSTARTS.some((qs) => !workflows.some((w) => w.name === qs.name)) && (
          <div className="quickstart">
            <p className="small muted">Start from an example route:</p>
            {QUICKSTARTS.filter((qs) => !workflows.some((w) => w.name === qs.name)).map((qs) => (
              <button key={qs.name} disabled={busy} onClick={() => quickstart(qs)}>
                {busy ? 'Importing...' : qs.button}
              </button>
            ))}
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
            <p className="muted">Create one, or import an example.</p>
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
  const itemLabel = (id: number) => itemFor(engine, id)?.name ?? `#${id}`;
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
                {analysis.unitItemId && !wf.unitItemId ? ` (${itemLabel(analysis.unitItemId)})` : ''}
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
          <div className="seg-field">
            <span>AH</span>
            <Segmented
              label="AH"
              value={wf.ahType}
              options={[
                { value: 'faction', label: 'Faction' },
                { value: 'neutral', label: 'Neutral' },
              ]}
              onChange={(ahType) => save({ ahType })}
            />
          </div>
          {analysis.buyLimit && (
            <label title="The buy price for this target leaves at least this much gold per hour">
              Target gold/hour
              <MoneyInput value={wf.targetGoldPerHour} onChange={(v) => save({ targetGoldPerHour: v })} placeholder="e.g. 5g" />
            </label>
          )}
        </div>
      </Panel>

      {analysis.ok && analysis.buyLimit ? <BuyLimitResults analysis={analysis} limit={analysis.buyLimit} target={wf.targetGoldPerHour} /> : <Results analysis={analysis} />}

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
        <AddStep
          onAdd={(step) => save({ steps: [...wf.steps, step] })}
          outputs={analysis.terminalOutputs.map((x) => x.itemId)}
        />
      </Panel>

      {analysis.ok && (
        <div className="grid2">
          <Panel title="Buy">
            {(['ah', 'vendor'] as const).map((source) => (
              <BuySection
                key={source}
                source={source}
                ahType={wf.ahType}
                inputs={analysis.externalInputs.filter((x) => x.source === source)}
                onMove={(itemId) => save({ buyMap: { ...wf.buyMap, [itemId]: source === 'ah' ? 'vendor' : 'ah' } })}
                onMake={(itemId, recipeId) => save({ steps: insertBeforeConsumer(engine, wf.steps, itemId, { type: 'recipe', recipeId }) })}
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
                          <AhPriceCell itemId={x.itemId} ahType={wf.ahType} />
                          <AhMinCell itemId={x.itemId} />
                          <AhPriceAge itemId={x.itemId} ahType={wf.ahType} />
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
                AH value is after the {Math.round(config.ahCut[wf.ahType] * 100)}% cut. The second price is the optional min AH price used for the
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
  ahType,
  inputs,
  onMove,
  onMake,
}: {
  source: 'ah' | 'vendor';
  /** The workflow's AH: prices are per AH (DEC-27). */
  ahType: AhType;
  inputs: ExternalInput[];
  onMove: (itemId: number) => void;
  onMake: (itemId: number, recipeId: string) => void;
}) {
  const total = inputs.reduce((sum, x) => sum + x.qtyPerBatch * (x.unitPrice ?? 0), 0);
  return (
    <section className="buy-section">
      <h3 className="buy-section-head">
        <span>{source === 'ah' ? 'Auction House' : 'Vendor'}</span>
        <span title="Cost of the whole batch from this source">
          <Money value={total} /> <span className="muted">/ batch</span>
        </span>
      </h3>
      {inputs.length === 0 ? (
        <p className="small muted">Nothing to buy here.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Per unit</th>
              <th className="r" title="Quantity for the whole batch, rounded up">
                Batch
              </th>
              <th>Price</th>
              <th className="r">Cost / unit</th>
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
                <td className="r">{fmtQty(x.qtyPerBatch)}</td>
                <td>
                  {source === 'ah' ? (
                    <div className="price-cell">
                      <AhPriceCell itemId={x.itemId} ahType={ahType} />
                      <AhPriceAge itemId={x.itemId} ahType={ahType} />
                    </div>
                  ) : (
                    <VendorBuyCell itemId={x.itemId} />
                  )}
                </td>
                <td className="r">
                  <Money value={x.costPerUnit} />
                </td>
                <td className="r nowrap">
                  <MakeButton itemId={x.itemId} onPick={(recipeId) => onMake(x.itemId, recipeId)} />{' '}
                  <button
                    className="icon-btn"
                    onClick={() => onMove(x.itemId)}
                    title={`Buy from ${source === 'ah' ? 'a vendor' : 'the AH'} instead`}
                    aria-label={`Move to ${source === 'ah' ? 'vendor' : 'AH'}`}
                  >
                    ⇄
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

/** Adds a step that makes this item. Hidden when no known recipe makes it; a list when several do. */
function MakeButton({ itemId, onPick }: { itemId: number; onPick: (recipeId: string) => void }) {
  const { engine } = useStore();
  const [open, setOpen] = useState(false);
  const producers = useMemo(() => producersOf(engine, itemId), [engine, itemId]);
  if (producers.length === 0) return null;
  const name = engine.items.get(itemId)?.name ?? `#${itemId}`;
  const title = producers.length === 1 ? `Add step: ${producers[0].name}` : `Add a step that makes ${name}`;
  return (
    <span className="combo inline-combo">
      <button
        className="icon-btn"
        title={title}
        aria-label={title}
        aria-expanded={producers.length > 1 ? open : undefined}
        onClick={() => (producers.length === 1 ? onPick(producers[0].id) : setOpen(!open))}
        onBlur={() => setOpen(false)}
      >
        +
      </button>
      {open && (
        <ul className="combo-list combo-right" role="listbox">
          {producers.map((r) => (
            <li
              key={r.id}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                onPick(r.id);
              }}
            >
              <span className="combo-name">
                {r.name} <span className="muted small">({r.kind})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </span>
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
                <span className="kpi-label">With min AH prices</span>
                <span className="kpi-value">
                  <Money value={sim.worstCase} signed />
                </span>
                <span className="kpi-sub">same batch, min AH sell prices</span>
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
          <span className="kpi-label">Investment per batch</span>
          <span className="kpi-value">
            <Money value={a.batchInvestment} />
          </span>
          <span className="kpi-sub">
            gold to buy all inputs
            {a.batchDeposits > 0 && (
              <>
                , plus up to <Money value={a.batchDeposits} /> in AH deposits
              </>
            )}
          </span>
        </div>
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
      <ResultNotes analysis={a} />
    </Panel>
  );
}

/**
 * Results of a workflow that buys "any item" to disenchant (DEC-20): the most to pay per item instead
 * of a profit, since the item's price is what gets solved for.
 */
function BuyLimitResults({ analysis: a, limit, target }: { analysis: WorkflowAnalysis; limit: BuyLimit; target: number | null }) {
  const sim = a.simulation;
  const perItem = limit.qtyPerUnit === 1 ? 'per item' : `per item (${round3(limit.qtyPerUnit)} per unit)`;
  const price = (v: number | null) => (v !== null && v < 0 ? <span className="neg">not profitable</span> : <Money value={v} />);
  return (
    <Panel className="results">
      <div className="kpis">
        <div className="kpi kpi-worst">
          <span className="kpi-label">Safe max buy price</span>
          <span className="kpi-value">{price(limit.worstCase)}</span>
          <span className="kpi-sub">
            {perItem}; 95% of batches of {a.batchSize} still break even
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{target !== null ? <>Buy price for <Money value={target} />/h</> : 'Buy price for a target'}</span>
          <span className="kpi-value">{target !== null ? price(limit.forTarget) : <span className="muted">-</span>}</span>
          <span className="kpi-sub">
            {target !== null ? `${perItem}, on average, for a batch of ${a.batchSize}` : 'set a target gold/hour above'}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Break-even buy price</span>
          <span className="kpi-value">{price(limit.breakEven)}</span>
          <span className="kpi-sub">{perItem}; expected profit is zero</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Time per item</span>
          <span className="kpi-value">{formatDuration(a.timePerUnitSec)}</span>
          <span className="kpi-sub">
            batch of {a.batchSize} takes {formatDuration(a.batchTimeSec)}
            {sim ? `, ${sim.runs.toLocaleString()} simulated` : ''}
          </span>
        </div>
      </div>
      <p className="small muted">
        Per <ItemName id={limit.itemId} />: outputs sell for <Money value={a.revenuePerUnit} />, other inputs cost <Money value={a.costPerUnit} />. Paying
        more than the break-even price loses money on average; the safe price also covers bad luck with drops and min AH prices.
      </p>
      <ResultNotes analysis={a} />
    </Panel>
  );
}

function ResultNotes({ analysis: a }: { analysis: WorkflowAnalysis }) {
  const sim = a.simulation;
  return (
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
  );
}

/** Only uncommon, rare and epic armor and weapons can be disenchanted. */
const disenchantable = (i: Item) => (i.itemClass === 'armor' || i.itemClass === 'weapon') && i.quality >= 2 && i.quality <= 4;

function AddStep({ onAdd, outputs }: { onAdd: (step: WorkflowStep) => void; outputs: number[] }) {
  const { engine, recipeRecords, mutateAsync } = useStore();
  const [mode, setMode] = useState<'recipe' | 'disenchant' | 'disenchant-any'>('recipe');
  const [any, setAny] = useState<{ quality: Quality; itemClass: 'armor' | 'weapon'; itemLevel: number | null }>({
    quality: 2,
    itemClass: 'armor',
    itemLevel: null,
  });
  const [err, setErr] = useState<string | null>(null);
  const recipes = recipeRecords.map((r) => engine.recipes.get(r.id)!).sort((a, b) => a.name.localeCompare(b.name));

  const addDisenchant = async (itemId: number) => {
    setErr(null);
    if (!engine.items.has(itemId)) {
      try {
        await mutateAsync((repo) => importItem(repo, itemId));
      } catch (e) {
        return setErr(errorText(e));
      }
    }
    onAdd({ type: 'disenchant', itemId });
  };

  const addAny = () => {
    if (any.itemLevel === null) return;
    onAdd({ type: 'disenchant-any', quality: any.quality, itemClass: any.itemClass, itemLevel: any.itemLevel });
  };

  // Items this workflow already makes that can be disenchanted come first.
  const deFromWorkflow = outputs.filter((id) => {
    const it = engine.items.get(id);
    return it !== undefined && disenchantable(it);
  });
  // Recipes that take something this workflow makes come first.
  const recipesFromWorkflow = useMemo(
    () => new Set(recipes.filter((r) => r.inputs.some((x) => outputs.includes(x.itemId))).map((r) => r.id)),
    [recipes, outputs],
  );
  const anyRule =
    any.itemLevel !== null
      ? findDisenchantRule(engine.deRules, itemFor(engine, anyItemId(any.quality, any.itemClass, any.itemLevel))!)
      : null;

  return (
    <div className="add-step">
      <Segmented
        value={mode}
        options={[
          { value: 'recipe', label: 'Recipe' },
          { value: 'disenchant', label: 'Disenchant' },
          { value: 'disenchant-any', label: 'Disenchant any' },
        ]}
        onChange={setMode}
      />
      {mode === 'recipe' ? (
        <RecipeSearch recipes={recipes} preferred={recipesFromWorkflow} onPick={(r) => onAdd({ type: 'recipe', recipeId: r.id })} />
      ) : mode === 'disenchant-any' ? (
        <>
          <select
            className={`q${any.quality}`}
            value={any.quality}
            onChange={(e) => setAny({ ...any, quality: Number(e.target.value) as Quality })}
            aria-label="Quality"
          >
            {([2, 3, 4] as const).map((q) => (
              <option key={q} value={q} className={`q${q}`}>
                {QUALITY_NAMES[q]}
              </option>
            ))}
          </select>
          <Segmented
            value={any.itemClass}
            options={[
              { value: 'armor', label: 'Armor' },
              { value: 'weapon', label: 'Weapon' },
            ]}
            onChange={(itemClass) => setAny({ ...any, itemClass })}
          />
          <NumberInput className="ilvl-input" value={any.itemLevel} onChange={(itemLevel) => setAny({ ...any, itemLevel })} min={1} step={1} placeholder="Item level" />
        </>
      ) : (
        <DisenchantSearch preferred={deFromWorkflow} onPick={addDisenchant} />
      )}
      {mode === 'disenchant-any' && (
        <>
          <button onClick={addAny}>Add step</button>
          {any.itemLevel !== null && (
            <span className={`small ${anyRule ? 'muted' : 'warn'}`}>
              {anyRule ? `Any item level ${anyRule.ilvlMin}-${anyRule.ilvlMax} disenchants the same.` : 'No disenchant rule matches this band yet.'}
            </span>
          )}
        </>
      )}
      {err && <span className="small warn">{err}</span>}
    </div>
  );
}

/** Search box for recipes by recipe, reagent or product name. Picking a result adds it. */
function RecipeSearch({ recipes, preferred, onPick }: { recipes: Recipe[]; preferred: ReadonlySet<string>; onPick: (r: Recipe) => void }) {
  const { engine } = useStore();
  const [query, setQuery] = useState('');
  const matches = useMemo(() => searchRecipes(recipes, engine.items, query, { preferred }), [recipes, engine.items, query, preferred]);

  return (
    <Combo
      className="recipe-search"
      text={query}
      onText={setQuery}
      options={matches}
      optionKey={(m) => m.recipe.id}
      onPick={(m) => {
        onPick(m.recipe);
        setQuery('');
      }}
      placeholder={recipes.length ? 'Search recipe, reagent or product...' : 'No recipes yet, import some first'}
      disabled={!recipes.length}
      empty="No recipe matches."
      renderOption={({ recipe: r, matchedItems }) => {
        // A recipe named after what it makes shows that item's icon and quality colour.
        const product = r.outputs.map((o) => engine.items.get(o.itemId)).find((i) => i?.name === r.name);
        return (
          <>
            <span className="combo-name">
              {product && <ItemIcon item={product} />}
              <span className={product ? `q${product.quality}` : ''}>{r.name}</span> <span className="muted small">({r.kind})</span>
              {preferred.has(r.id) && <span className="combo-tag small">uses workflow output</span>}
            </span>
            <span className="combo-io small muted">
              {r.inputs.map((x, k) => (
                <span key={k}>
                  {k > 0 && ' + '}
                  {x.qty} <ComboItem id={x.itemId} hit={matchedItems.includes(x.itemId)} />
                </span>
              ))}
              {' → '}
              {r.outputs.map((o, k) => (
                <span key={k}>
                  {k > 0 && ', '}
                  <ComboItem id={o.itemId} hit={matchedItems.includes(o.itemId)} />
                </span>
              ))}
            </span>
          </>
        );
      }}
    />
  );
}

/** Small icon and quality-coloured name for the second line of a search result. */
function ComboItem({ id, hit = false }: { id: number; hit?: boolean }) {
  const { engine } = useStore();
  const item = engine.items.get(id);
  return (
    <span className={`combo-item ${hit ? 'hit' : ''}`}>
      <ItemIcon item={item} />
      <span className={item ? `q${item.quality}` : ''}>{item?.name ?? `#${id}`}</span>
    </span>
  );
}

const DE_SEARCH_LIMIT = 50;

/**
 * Search box for an item to disenchant, styled like the recipe search. Picking a result adds it;
 * Enter on a typed item ID that is not in the catalog imports it first.
 */
function DisenchantSearch({ preferred, onPick }: { preferred: number[]; onPick: (itemId: number) => void }) {
  const { engine } = useStore();
  const [query, setQuery] = useState('');
  const typedId = /^#?(\d+)$/.exec(query.trim());
  const matches = useMemo(() => {
    const rank = (id: number) => {
      const i = preferred.indexOf(id);
      return i < 0 ? preferred.length : i;
    };
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...engine.items.values()]
      .filter(disenchantable)
      .filter((i) => (typedId ? i.id === Number(typedId[1]) : terms.every((t) => i.name.toLowerCase().includes(t))))
      .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
      .slice(0, DE_SEARCH_LIMIT);
  }, [engine.items, preferred, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (id: number) => {
    onPick(id);
    setQuery('');
  };

  return (
    <Combo
      className="recipe-search"
      text={query}
      onText={setQuery}
      options={matches}
      optionKey={(i) => i.id}
      onPick={(i) => pick(i.id)}
      onCommit={() => typedId && !engine.items.has(Number(typedId[1])) && pick(Number(typedId[1]))}
      placeholder="Search item to disenchant, or type an item ID..."
      empty={typedId ? `Press Enter to import item #${typedId[1]}` : 'No item matches. Type an item ID to import it.'}
      renderOption={(i) => {
        const rule = findDisenchantRule(engine.deRules, i);
        return (
          <>
            <span className="combo-name">
              <ItemIcon item={i} />
              <span className={`q${i.quality}`}>{i.name}</span>
              <span className="muted small">
                ilvl {i.itemLevel ?? '?'} {i.itemClass}
              </span>
              {preferred.includes(i.id) && <span className="combo-tag small">made in this workflow</span>}
            </span>
            {rule ? (
              <span className="combo-io small muted">
                →{' '}
                {rule.outputs.map((o, k) => (
                  <span key={k}>
                    {k > 0 && ', '}
                    <ComboItem id={o.itemId} />
                  </span>
                ))}
              </span>
            ) : (
              <span className="combo-io small warn">No disenchant rule matches this item yet.</span>
            )}
          </>
        );
      }}
    />
  );
}
