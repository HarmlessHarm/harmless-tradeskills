import type { ReactNode } from 'react';
import type { TourId } from '../../db/repo';
import { ahKey } from '../../engine/prices';
import type { Workflow } from '../../engine/types';
import { buySourceFor } from '../../engine/workflow';
import type { useStore } from '../../state/store';
import type { useTour } from './Tour';

export interface TourCtx {
  store: ReturnType<typeof useStore>;
  /** Workflow tour: the workflow the user made in it. */
  wf: Workflow | undefined;
  tour: ReturnType<typeof useTour>;
  /** Whether an element with this data-tour is on the page. */
  el: (target: string) => boolean;
}

export interface TourStep {
  /** Tab the step is on. */
  page: 'workflows' | 'flip';
  /** The data-tour element to point at; null for a centred card. */
  target: string | null | ((c: TourCtx) => string | null);
  title: string;
  body: ReactNode | ((c: TourCtx) => ReactNode);
  /** Moves on by itself once this is true. */
  done?: (c: TourCtx) => boolean;
  /** Passed over when this is true. */
  skip?: (c: TourCtx) => boolean;
  /** Label of the button that moves on without `done`. */
  next?: string;
  /** Buttons that replace Next, for the last step. */
  actions?: (c: TourCtx) => ReactNode;
}

// Items and recipes of the DE shuffle, all in the starter data.
const LINEN = 2589;
const BOLT = 2996;
const GLOVES = 4307;
const WOOD = 4470;
const R_BOLT = 'spell:2963';
const R_GLOVES = 'spell:3840';
const R_OIL = 'spell:25124';
const R_WAND = 'spell:14807';

const hasRecipe = (wf: Workflow | undefined, id: string) => !!wf?.steps.some((s) => s.type === 'recipe' && s.recipeId === id);
const hasDe = (wf: Workflow | undefined, id: number) => !!wf?.steps.some((s) => s.type === 'disenchant' && s.itemId === id);
const woodFromVendor = ({ store, wf }: TourCtx) =>
  !!wf && buySourceFor(store.engine, wf, WOOD) === 'vendor' && store.itemRecords.find((r) => r.id === WOOD)?.vendorBuy != null;
const Check = ({ ok }: { ok: boolean }) => <span className={ok ? 'pos' : 'muted'}>{ok ? '✓' : '○'}</span>;

const RESTART = <p className="muted">You can restart both tours any time from Settings &gt; Tutorials.</p>;

export const TOURS: Record<TourId, TourStep[]> = {
  workflow: [
    {
      page: 'workflows',
      target: 'wf-new',
      title: 'Create a workflow',
      body: (
        <>
          <p>
            A workflow is a route you run in game. Let's build the <b>DE shuffle</b>: linen into gloves, disenchant the gloves, and turn the dust and essence into oil
            and a wand.
          </p>
          <p>Press New.</p>
        </>
      ),
      done: ({ wf }) => wf !== undefined,
    },
    {
      page: 'workflows',
      target: 'wf-name',
      title: 'Give it a name',
      body: <p>Call it something you will recognise, like "My DE shuffle". It saves as you type.</p>,
      next: 'Next',
    },
    {
      page: 'workflows',
      target: 'wf-add-step',
      title: 'Add what you craft',
      body: (
        <p>
          Search for <b className="q2">Heavy Linen Gloves</b> and pick the recipe. You can search by recipe, reagent or product name.
        </p>
      ),
      done: ({ wf }) => hasRecipe(wf, R_GLOVES),
    },
    {
      page: 'workflows',
      target: `make-${BOLT}`,
      title: 'Make your own bolts',
      body: (
        <p>
          The gloves need <b>Bolt of Linen Cloth</b>. Instead of buying bolts, press <b>+</b> to add the recipe that makes them from Linen Cloth. The workflow works out
          how many times each step runs.
        </p>
      ),
      done: ({ wf }) => hasRecipe(wf, R_BOLT),
    },
    {
      page: 'workflows',
      target: 'wf-add-step',
      title: 'Disenchant the gloves',
      body: (
        <p>
          Switch the step type to <b>Disenchant</b> and pick <b className="q2">Heavy Linen Gloves</b>, tagged "made in this workflow". The disenchant rules give the
          chances of dust and essence.
        </p>
      ),
      done: ({ wf }) => hasDe(wf, GLOVES),
    },
    {
      page: 'workflows',
      target: 'wf-add-step',
      title: 'Use the dust and essence',
      body: ({ wf }) => (
        <>
          <p>Back on Recipe, recipes that use something this workflow makes come first. Add both:</p>
          <p>
            <Check ok={hasRecipe(wf, R_OIL)} /> Minor Wizard Oil, from Strange Dust
            <br />
            <Check ok={hasRecipe(wf, R_WAND)} /> Greater Magic Wand, from Lesser Magic Essence
          </p>
        </>
      ),
      done: ({ wf }) => hasRecipe(wf, R_OIL) && hasRecipe(wf, R_WAND),
    },
    {
      page: 'workflows',
      target: 'wf-results',
      title: 'What a run earns',
      body: (
        <>
          <p>The cards sum up a batch:</p>
          <ul>
            <li>
              <b>Worst case</b>: disenchanting is random, so a batch is simulated thousands of times. 95% of batches do at least this well.
            </li>
            <li>
              <b>P5 / median / P95</b>: an unlucky, a normal and a lucky batch.
            </li>
            <li>
              <b>Investment</b>: the gold you need up front to buy everything.
            </li>
            <li>
              <b>Gold per hour</b>: profit over the time a batch takes, casts and overhead included.
            </li>
            <li>
              <b>Profit per unit</b>: the average, per unit.
            </li>
          </ul>
          <p className="muted">Numbers look off until prices are in. We fill those in shortly.</p>
        </>
      ),
      next: 'Next',
    },
    {
      page: 'workflows',
      target: 'wf-unit',
      title: 'Per unit of what?',
      body: (
        <p>
          Every number is per unit of the last thing made. Pick <b>Linen Cloth</b> under Base materials to see the profit per linen cloth you put in: handy when you
          farm linen or buy it in bulk.
        </p>
      ),
      done: ({ wf }) => wf?.unitItemId === LINEN,
      next: 'Skip this',
    },
    {
      page: 'workflows',
      target: 'wf-batch',
      title: 'Batch size',
      body: <p>A batch is one session: how many units you make in one go. It sets the investment, the time and the worst case. Bigger batches smooth out bad luck.</p>,
      next: 'Next',
    },
    {
      page: 'workflows',
      target: `buy-${LINEN}`,
      title: 'Fill in the AH price',
      body: (
        <>
          <p>
            Linen Cloth is bought on the AH. Type what it costs now, <b>around 70c</b>, and press Enter.
          </p>
          <p className="muted">Every AH price you type is kept as a price snapshot. The AH flipper uses the same prices.</p>
        </>
      ),
      done: ({ store, wf }) => !!wf && store.engine.ahPrices.has(ahKey(LINEN, wf.ahType)),
      next: 'Skip this',
    },
    {
      page: 'workflows',
      target: (c) => (woodFromVendor(c) || !c.el(`move-${WOOD}`) ? `vendor-${WOOD}` : `move-${WOOD}`),
      title: 'Simple Wood comes from a vendor',
      body: (c) =>
        buySourceFor(c.store.engine, c.wf!, WOOD) === 'vendor' ? (
          <p>Now type the price the vendor asks for Simple Wood and press Enter.</p>
        ) : (
          <p>
            The starter data has no vendor price for Simple Wood, so it landed under Auction House. Press <b>⇄</b> to buy it from a vendor instead.
          </p>
        ),
      // Already sorted when the starter data has a vendor price for it.
      skip: ({ wf }) => !hasRecipe(wf, R_WAND),
      done: woodFromVendor,
      next: 'Skip this',
    },
    {
      page: 'workflows',
      target: 'wf-buy-vendor',
      title: 'Vendor prices',
      body: (
        <p>
          Thread, seed and vial come from a vendor, and their prices came with the starter data. Any price here can be changed: it is saved on the item for every
          workflow.
        </p>
      ),
      next: 'Next',
    },
    {
      page: 'workflows',
      target: 'wf-sell',
      title: 'Where the results go',
      body: (
        <p>
          Oil and wands go to a vendor by default, because there is no AH price for them yet. Switch one to <b>AH</b> to sell it there: its value is shown after the AH
          cut. <b>Keep</b> leaves it out of the profit.
        </p>
      ),
      next: 'Next',
    },
    {
      page: 'workflows',
      target: null,
      title: 'Your first workflow is done',
      body: (
        <>
          <p>The cards at the top now show what a run earns. Change a price or a step and they update straight away.</p>
          <p>Next up is the AH flipper: it tracks prices and tells you when a flip is worth it.</p>
          {RESTART}
        </>
      ),
      actions: ({ tour }) => (
        <>
          <button
            onClick={() => {
              tour.end(true, { skip: 'flip' });
              window.location.hash = 'start';
            }}
          >
            Skip for now
          </button>
          <button
            className="primary"
            onClick={() => tour.end(true, { start: 'flip' })}
          >
            Show me the AH flipper
          </button>
        </>
      ),
    },
  ],

  flip: [
    {
      page: 'flip',
      target: 'flip-watchlist',
      title: 'The AH flipper',
      body: (
        <p>
          Every item a workflow buys or sells on the AH shows up here, next to the items you favorite. Prices come from the AH prices you record, here or in a
          workflow.
        </p>
      ),
      next: 'Next',
    },
    {
      page: 'flip',
      target: 'flip-add',
      title: 'Add Linen Cloth',
      body: (
        <p>
          Linen Cloth is not on your list yet. Type <b>Linen Cloth</b> in "Add item to watch" and pick it.
        </p>
      ),
      skip: ({ el }) => el(`flip-row-${LINEN}`),
      done: ({ el }) => el(`flip-row-${LINEN}`),
    },
    {
      page: 'flip',
      target: `flip-star-${LINEN}`,
      title: 'Favorites and workflow items',
      body: (
        <>
          <p>
            The <span className="badge wf">workflow</span> badge means a workflow uses the item: it stays listed as long as one does.
          </p>
          <p>
            The star makes an item a favorite, for things you flip without a workflow. Unstar a favorite no workflow uses and it leaves the list after a few seconds;
            click the star again to keep it.
          </p>
        </>
      ),
      next: 'Next',
    },
    {
      page: 'flip',
      target: `flip-row-${LINEN}`,
      title: 'Open the calculator',
      body: <p>Click the Linen Cloth row.</p>,
      skip: ({ el }) => el('flip-calc'),
      done: ({ el }) => el('flip-calc'),
    },
    {
      page: 'flip',
      target: 'flip-calc',
      title: 'Quick calculator',
      body: (
        <>
          <p>
            Type the price you see on the AH in <b>I see it at</b>. It says <b>Buy</b> or <b>Too high</b> against "buy below", which comes from the typical price and
            your target margin.
          </p>
          <p>
            Below that: the profit if it sells first time, the AH cut, the deposit, and how many relists the flip can take before it stops paying. <b>Log buy</b>{' '}
            writes the buy to the ledger.
          </p>
        </>
      ),
      next: 'Next',
    },
    {
      page: 'flip',
      target: 'flip-prices',
      title: 'AH price tracker',
      body: (
        <>
          <p>
            Record what you see on the AH: the lowest price, and if you like more rows as quantity x price. Each save is a snapshot. The typical price, n and the chart
            come from these, and workflows use them too.
          </p>
          <p className="muted">The linen price you typed in the workflow is already here.</p>
        </>
      ),
      next: 'Next',
    },
    {
      page: 'flip',
      target: 'flip-ledger',
      title: 'Ledger',
      body: (
        <p>
          Log what you buy and sell to track what you hold, what it cost and what you made. The <b>floor</b> is the lowest sell price that still covers your cost, the
          AH cut and a lost deposit.
        </p>
      ),
      next: 'Next',
    },
    {
      page: 'flip',
      target: 'flip-summary',
      title: 'Summary',
      body: <p>Totals for your whole watchlist: what you hold, what it cost, and what you earned in the last 30 days.</p>,
      next: 'Next',
    },
    {
      page: 'flip',
      target: null,
      title: "That's the AH flipper",
      body: (
        <>
          <p>Back on Get started: how to keep the data fresh, what is in Settings, and how to back up.</p>
          {RESTART}
        </>
      ),
      actions: ({ tour }) => (
        <button
          className="primary"
          onClick={() => {
            tour.end(true);
            window.location.hash = 'start';
          }}
        >
          Back to Get started
        </button>
      ),
    },
  ],
};
