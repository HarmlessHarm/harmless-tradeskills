import { netOnSale } from './ah';
import { deriveDisenchantRecipe } from './disenchant';
import { expectedQty } from './items';
import { price, type PriceContext } from './prices';
import { mulberry32, percentile, randInt } from './random';
import type {
  BuySource,
  Config,
  Copper,
  DisenchantRule,
  Disposition,
  Item,
  Recipe,
  Workflow,
  WorkflowStep,
} from './types';

export interface EngineData extends PriceContext {
  items: Map<number, Item>;
  recipes: Map<string, Recipe>;
  deRules: DisenchantRule[];
  config: Config;
}

export interface StepAnalysis {
  index: number;
  recipe: Recipe;
  runsPerUnit: number;
  /** Seconds per unit spent on this step, including per-action overhead. */
  secondsPerUnit: number;
}

export interface ExternalInput {
  itemId: number;
  qtyPerUnit: number;
  source: BuySource;
  unitPrice: Copper | null;
  costPerUnit: Copper;
}

export interface TerminalOutput {
  itemId: number;
  qtyPerUnit: number;
  disposition: Disposition;
  /** Copper received per item after fees. */
  unitValue: Copper | null;
  valuePerUnit: Copper;
}

export interface MissingPrice {
  itemId: number;
  what: 'ah price' | 'vendor buy price' | 'vendor sell price';
}

export interface SimulationResult {
  batchSize: number;
  runs: number;
  p5: Copper;
  p50: Copper;
  p95: Copper;
  mean: Copper;
  /** P5 using pessimistic AH prices where set (REQ-4.2). The headline worst case. */
  worstCase: Copper;
  /** Average leftover intermediates per batch (REQ-6.7). */
  leftovers: { itemId: number; avgQty: number }[];
}

export interface WorkflowAnalysis {
  ok: boolean;
  errors: string[];
  warnings: string[];
  unitItemId: number | null;
  steps: StepAnalysis[];
  externalInputs: ExternalInput[];
  terminalOutputs: TerminalOutput[];
  tools: number[];
  missingPrices: MissingPrice[];
  costPerUnit: Copper;
  revenuePerUnit: Copper;
  profitPerUnit: Copper;
  timePerUnitSec: number;
  batchSize: number;
  batchTimeSec: number;
  batchProfit: Copper;
  goldPerHourCopper: Copper;
  simulation: SimulationResult | null;
}

const EPS = 1e-9;

export function resolveStep(data: EngineData, step: WorkflowStep): Recipe | null {
  if (step.type === 'recipe') return data.recipes.get(step.recipeId) ?? null;
  const item = data.items.get(step.itemId);
  if (!item) return null;
  return deriveDisenchantRecipe(data.deRules, item, data.config.disenchantCastMs);
}

export function describeStep(data: EngineData, step: WorkflowStep): string {
  if (step.type === 'recipe') return data.recipes.get(step.recipeId)?.name ?? `Missing recipe ${step.recipeId}`;
  return `Disenchant ${data.items.get(step.itemId)?.name ?? `item #${step.itemId}`}`;
}

/**
 * Default unit: the item fed into the first non-craft step (e.g. the gloves that get disenchanted),
 * otherwise the first step's main product.
 */
export function defaultUnitItem(recipes: Recipe[]): number | null {
  const firstNonCraft = recipes.findIndex((r, i) => i > 0 && r.kind !== 'craft');
  if (firstNonCraft > 0) {
    const prev = recipes[firstNonCraft - 1];
    const fed = prev.outputs.find((o) => recipes[firstNonCraft].inputs.some((i) => i.itemId === o.itemId));
    if (fed) return fed.itemId;
  }
  return recipes[0]?.outputs[0]?.itemId ?? null;
}

interface Links {
  /** linked[s] = set of input item IDs of step s that come from an earlier step (REQ-6.2). */
  linked: Set<number>[];
  /** Items that some later step consumes from an earlier producer. */
  intermediates: Set<number>;
}

function computeLinks(recipes: Recipe[]): Links {
  const linked: Set<number>[] = [];
  const intermediates = new Set<number>();
  const producedSoFar = new Set<number>();
  for (const r of recipes) {
    const set = new Set<number>();
    for (const input of r.inputs) {
      if (producedSoFar.has(input.itemId)) {
        set.add(input.itemId);
        intermediates.add(input.itemId);
      }
    }
    linked.push(set);
    for (const o of r.outputs) producedSoFar.add(o.itemId);
  }
  return { linked, intermediates };
}

const producedBy = (r: Recipe, itemId: number) =>
  r.outputs.filter((o) => o.itemId === itemId).reduce((sum, o) => sum + expectedQty(o), 0);
const consumedBy = (r: Recipe, itemId: number) =>
  r.inputs.filter((i) => i.itemId === itemId).reduce((sum, i) => sum + i.qty, 0);

/**
 * Solve runs per unit (REQ-6.3). One equation fixes production of the unit item at 1; every
 * intermediate item is balanced: what earlier steps make is what later steps use.
 */
function solveRuns(
  recipes: Recipe[],
  links: Links,
  unitItemId: number,
): { runs: number[] } | { error: string } {
  const n = recipes.length;
  const rows: number[][] = [];
  const rhs: number[] = [];

  const unitRow = recipes.map((r) => producedBy(r, unitItemId));
  if (unitRow.every((x) => Math.abs(x) < EPS)) return { error: 'No step produces the unit item.' };
  rows.push(unitRow);
  rhs.push(1);

  for (const itemId of links.intermediates) {
    const consumers = recipes.map((_, s) => s).filter((s) => links.linked[s].has(itemId));
    const lastConsumer = Math.max(...consumers);
    rows.push(
      recipes.map((r, s) => {
        let v = 0;
        if (s < lastConsumer) v += producedBy(r, itemId);
        if (links.linked[s].has(itemId)) v -= consumedBy(r, itemId);
        return v;
      }),
    );
    rhs.push(0);
  }

  // Gauss-Jordan elimination with partial pivoting.
  const m = rows.length;
  const a = rows.map((row, i) => [...row, rhs[i]]);
  let rank = 0;
  const pivotCols: number[] = [];
  for (let col = 0; col < n && rank < m; col++) {
    let best = rank;
    for (let r = rank + 1; r < m; r++) if (Math.abs(a[r][col]) > Math.abs(a[best][col])) best = r;
    if (Math.abs(a[best][col]) < EPS) continue;
    [a[rank], a[best]] = [a[best], a[rank]];
    const pivot = a[rank][col];
    for (let c = col; c <= n; c++) a[rank][c] /= pivot;
    for (let r = 0; r < m; r++) {
      if (r === rank) continue;
      const f = a[r][col];
      if (Math.abs(f) < EPS) continue;
      for (let c = col; c <= n; c++) a[r][c] -= f * a[rank][c];
    }
    pivotCols.push(col);
    rank++;
  }
  for (let r = rank; r < m; r++) {
    if (Math.abs(a[r][n]) > 1e-7) return { error: 'The steps do not balance: an intermediate item is over- or under-used.' };
  }
  if (rank < n) {
    const free = recipes.map((r, s) => (pivotCols.includes(s) ? null : r.name)).filter(Boolean);
    return { error: `Not connected to the unit item: ${free.join(', ')}.` };
  }
  const runs = new Array<number>(n).fill(0);
  pivotCols.forEach((col, r) => (runs[col] = a[r][n]));
  const negative = runs.findIndex((x) => x < -EPS);
  if (negative >= 0) return { error: `Step "${recipes[negative].name}" would need negative runs.` };
  return { runs: runs.map((x) => (Math.abs(x) < EPS ? 0 : x)) };
}

function defaultBuySource(data: EngineData, itemId: number): BuySource {
  return price(data, itemId, 'vendor-buy') !== null ? 'vendor' : 'ah';
}

function defaultDisposition(data: EngineData, itemId: number): Disposition {
  return price(data, itemId, 'ah') !== null ? 'ah' : 'vendor';
}

export function buySourceFor(data: EngineData, wf: Workflow, itemId: number): BuySource {
  return wf.buyMap[itemId] ?? defaultBuySource(data, itemId);
}

export function dispositionFor(data: EngineData, wf: Workflow, itemId: number): Disposition {
  return wf.sellMap[itemId] ?? defaultDisposition(data, itemId);
}

function buyPrice(data: EngineData, itemId: number, source: BuySource): Copper | null {
  return price(data, itemId, source === 'vendor' ? 'vendor-buy' : 'ah');
}

function saleValue(
  data: EngineData,
  wf: Workflow,
  itemId: number,
  disposition: Disposition,
  pessimistic: boolean,
): Copper | null {
  if (disposition === 'keep') return 0;
  if (disposition === 'vendor') return price(data, itemId, 'vendor-sell');
  const p = price(data, itemId, pessimistic ? 'ah-pessimistic' : 'ah');
  return p === null ? null : netOnSale(data.config, p, wf.ahType);
}

function emptyAnalysis(errors: string[], unitItemId: number | null = null): WorkflowAnalysis {
  return {
    ok: false,
    errors,
    warnings: [],
    unitItemId,
    steps: [],
    externalInputs: [],
    terminalOutputs: [],
    tools: [],
    missingPrices: [],
    costPerUnit: 0,
    revenuePerUnit: 0,
    profitPerUnit: 0,
    timePerUnitSec: 0,
    batchSize: 0,
    batchTimeSec: 0,
    batchProfit: 0,
    goldPerHourCopper: 0,
    simulation: null,
  };
}

export interface AnalyzeOptions {
  simulate?: boolean;
  seed?: number;
}

export function analyzeWorkflow(data: EngineData, wf: Workflow, opts: AnalyzeOptions = {}): WorkflowAnalysis {
  if (wf.steps.length === 0) return emptyAnalysis(['Add at least one step.']);

  const recipes: Recipe[] = [];
  const errors: string[] = [];
  wf.steps.forEach((step, i) => {
    const r = resolveStep(data, step);
    if (!r) {
      errors.push(
        step.type === 'disenchant'
          ? `Step ${i + 1}: no disenchant rule matches ${describeStep(data, step).replace('Disenchant ', '')}.`
          : `Step ${i + 1}: recipe ${step.recipeId} not found.`,
      );
    } else recipes.push(r);
  });
  if (errors.length) return emptyAnalysis(errors);

  const unitItemId = wf.unitItemId ?? defaultUnitItem(recipes);
  if (unitItemId === null) return emptyAnalysis(['Cannot pick a unit item: the first step has no outputs.']);

  const links = computeLinks(recipes);
  const solved = solveRuns(recipes, links, unitItemId);
  if ('error' in solved) return emptyAnalysis([solved.error], unitItemId);
  const runs = solved.runs;
  const cfg = data.config;

  // Material flow per unit.
  const bought = new Map<number, number>();
  const net = new Map<number, number>();
  const tools = new Set<number>();
  recipes.forEach((r, s) => {
    for (const input of r.inputs) {
      net.set(input.itemId, (net.get(input.itemId) ?? 0) - runs[s] * input.qty);
      if (!links.linked[s].has(input.itemId))
        bought.set(input.itemId, (bought.get(input.itemId) ?? 0) + runs[s] * input.qty);
    }
    for (const o of r.outputs) net.set(o.itemId, (net.get(o.itemId) ?? 0) + runs[s] * expectedQty(o));
    r.tools.forEach((t) => tools.add(t));
  });

  const missing: MissingPrice[] = [];
  const noteMissing = (itemId: number, what: MissingPrice['what']) => {
    if (!missing.some((m) => m.itemId === itemId && m.what === what)) missing.push({ itemId, what });
  };

  const externalInputs: ExternalInput[] = [];
  for (const [itemId, qty] of bought) {
    if (qty < EPS) continue;
    const source = buySourceFor(data, wf, itemId);
    const unitPrice = buyPrice(data, itemId, source);
    if (unitPrice === null) noteMissing(itemId, source === 'vendor' ? 'vendor buy price' : 'ah price');
    externalInputs.push({ itemId, qtyPerUnit: qty, source, unitPrice, costPerUnit: (unitPrice ?? 0) * qty });
  }

  const terminalOutputs: TerminalOutput[] = [];
  for (const [itemId, n] of net) {
    const qty = n + (bought.get(itemId) ?? 0);
    if (qty < 1e-7) continue;
    const disposition = dispositionFor(data, wf, itemId);
    const unitValue = saleValue(data, wf, itemId, disposition, false);
    if (unitValue === null) noteMissing(itemId, disposition === 'vendor' ? 'vendor sell price' : 'ah price');
    terminalOutputs.push({ itemId, qtyPerUnit: qty, disposition, unitValue, valuePerUnit: (unitValue ?? 0) * qty });
  }

  const steps: StepAnalysis[] = recipes.map((recipe, index) => ({
    index,
    recipe,
    runsPerUnit: runs[index],
    secondsPerUnit: runs[index] * (recipe.castTimeMs / 1000 + cfg.perActionOverheadSec),
  }));

  const costPerUnit = externalInputs.reduce((s, x) => s + x.costPerUnit, 0);
  const revenuePerUnit = terminalOutputs.reduce((s, x) => s + x.valuePerUnit, 0);
  const profitPerUnit = revenuePerUnit - costPerUnit;
  const timePerUnitSec = steps.reduce((s, x) => s + x.secondsPerUnit, 0);
  const batchSize = Math.max(1, wf.batchSize ?? cfg.defaultBatchSize);
  const batchTimeSec = batchSize * timePerUnitSec + cfg.perBatchOverheadSec;
  const batchProfit = profitPerUnit * batchSize;
  const goldPerHourCopper = batchTimeSec > 0 ? (batchProfit / batchTimeSec) * 3600 : 0;

  const warnings: string[] = [];
  if (missing.length) warnings.push('Some prices are missing and count as 0.');
  if (terminalOutputs.some((o) => o.disposition === 'ah'))
    warnings.push('AH sales assume the item sells on the first listing (deposit refunded).');

  const analysis: WorkflowAnalysis = {
    ok: true,
    errors: [],
    warnings,
    unitItemId,
    steps,
    externalInputs,
    terminalOutputs,
    tools: [...tools],
    missingPrices: missing,
    costPerUnit,
    revenuePerUnit,
    profitPerUnit,
    timePerUnitSec,
    batchSize,
    batchTimeSec,
    batchProfit,
    goldPerHourCopper,
    simulation: null,
  };

  if (opts.simulate !== false) {
    analysis.simulation = simulateBatch(data, wf, recipes, links, runs, analysis, opts.seed ?? 1);
  }
  return analysis;
}

/**
 * Monte Carlo of a batch of N units with whole runs and whole items (REQ-6.5, DEC-10).
 * Steps that only use bought inputs run round(runsPerUnit * N) times. Steps fed by earlier
 * steps use as much of the linked inventory as they can. Unused intermediates are leftovers.
 */
function simulateBatch(
  data: EngineData,
  wf: Workflow,
  recipes: Recipe[],
  links: Links,
  runsPerUnit: number[],
  analysis: WorkflowAnalysis,
  seed: number,
): SimulationResult {
  const N = analysis.batchSize;
  const iterations = Math.max(100, data.config.simulationRuns);
  const rng = mulberry32(seed);

  const buyCost = new Map<number, number>();
  for (const x of analysis.externalInputs) buyCost.set(x.itemId, x.unitPrice ?? 0);
  const terminal = new Map<number, { normal: number; worst: number }>();
  for (const x of analysis.terminalOutputs) {
    terminal.set(x.itemId, {
      normal: x.unitValue ?? 0,
      worst: saleValue(data, wf, x.itemId, x.disposition, true) ?? 0,
    });
  }

  const profits: number[] = [];
  const worst: number[] = [];
  const leftoverTotals = new Map<number, number>();

  for (let it = 0; it < iterations; it++) {
    const inv = new Map<number, number>();
    let cost = 0;
    recipes.forEach((r, s) => {
      let n: number;
      if (links.linked[s].size === 0) n = Math.round(runsPerUnit[s] * N);
      else {
        n = Infinity;
        for (const input of r.inputs) {
          if (links.linked[s].has(input.itemId)) n = Math.min(n, Math.floor((inv.get(input.itemId) ?? 0) / input.qty));
        }
      }
      if (n <= 0) return;
      for (const input of r.inputs) {
        if (links.linked[s].has(input.itemId)) inv.set(input.itemId, (inv.get(input.itemId) ?? 0) - n * input.qty);
        else cost += n * input.qty * (buyCost.get(input.itemId) ?? 0);
      }
      for (let k = 0; k < n; k++) {
        if (r.outputMode === 'exclusive') {
          let roll = rng();
          for (const o of r.outputs) {
            if (roll < o.chance) {
              inv.set(o.itemId, (inv.get(o.itemId) ?? 0) + randInt(rng, o.minQty, o.maxQty));
              break;
            }
            roll -= o.chance;
          }
        } else {
          for (const o of r.outputs) {
            if (o.chance >= 1 || rng() < o.chance)
              inv.set(o.itemId, (inv.get(o.itemId) ?? 0) + randInt(rng, o.minQty, o.maxQty));
          }
        }
      }
    });
    let revenue = 0;
    let revenueWorst = 0;
    for (const [itemId, qty] of inv) {
      if (qty <= 0) continue;
      const t = terminal.get(itemId);
      if (t) {
        revenue += qty * t.normal;
        revenueWorst += qty * t.worst;
      } else if (links.intermediates.has(itemId)) {
        leftoverTotals.set(itemId, (leftoverTotals.get(itemId) ?? 0) + qty);
      }
    }
    profits.push(revenue - cost);
    worst.push(revenueWorst - cost);
  }

  profits.sort((a, b) => a - b);
  worst.sort((a, b) => a - b);
  return {
    batchSize: N,
    runs: iterations,
    p5: percentile(profits, 5),
    p50: percentile(profits, 50),
    p95: percentile(profits, 95),
    mean: profits.reduce((s, x) => s + x, 0) / profits.length,
    worstCase: percentile(worst, 5),
    leftovers: [...leftoverTotals]
      .map(([itemId, total]) => ({ itemId, avgQty: total / iterations }))
      .filter((x) => x.avgQty > 0.005),
  };
}
