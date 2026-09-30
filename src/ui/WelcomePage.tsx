import { useState, type ReactNode } from 'react';
import type { TourId, TourStatus } from '../db/repo';
import { useStore } from '../state/store';
import { Panel } from './common';
import { Icon } from './icons';
import { useTour } from './tour/Tour';

/**
 * Getting started, in the order a new user meets things: the starter data, a guided workflow, a
 * guided AH flipper, keeping data fresh, settings and backups, and a beta note.
 */
export function WelcomePage() {
  const { itemRecords, recipeRecords, config } = useStore();
  const { onboarding } = useTour();
  const vendorPrices = itemRecords.filter((r) => r.vendorBuy !== null).length;
  const professions = new Set(recipeRecords.map((r) => r.imported.profession).filter(Boolean)).size;

  return (
    <div className="stack narrow welcome">
      <Panel>
        <span className="badge beta">Beta</span>
        <h1 className="welcome-title">Welcome to Harmless Tradeskills</h1>
        <p>
          Model a profession route once: crafting, disenchanting, auction house flips. Then see what it earns, how long it takes, the gold per hour and what the worst
          case looks like.
        </p>
        <p className="muted small">There is no account. Everything you do is stored in this browser.</p>
      </Panel>

      <ol className="onboard">
        <Step n={1} title="A head start">
          <p>
            We took the liberty of starting you off with the recipes of every profession from 1 to 150: <b>{recipeRecords.length} recipes</b>
            {professions > 0 && <> across {professions} professions</>}, the <b>{itemRecords.length} items</b> they use and make, and{' '}
            <b>{vendorPrices} vendor prices</b>. So you can build a workflow straight away.
          </p>
        </Step>

        <TourStep n={2} tour="workflow" status={onboarding.tours.workflow} title="Build your first workflow">
          <p>
            A workflow is a route you run in game. We will build the DE shuffle together, step by step on the Workflows page: linen into Heavy Linen Gloves, disenchant
            them, and turn the dust and essence into oil and wands. Along the way you see what the numbers at the top mean and how prices go in.
          </p>
        </TourStep>

        <TourStep n={3} tour="flip" status={onboarding.tours.flip} title="Meet the AH flipper">
          <p>
            The AH flipper keeps a watchlist of items, tracks the prices you see, tells you when a flip is worth it and keeps a ledger of what you bought and sold.
            Best after the workflow tour: the linen from your workflow shows up there.
          </p>
        </TourStep>

        <Step n={4} title="Keeping the data fresh">
          <p>
            The starter recipes and items come from Wowhead as they were when we made them. WoW Forever is still changing, so some will go out of date. Refresh them in
            Settings &gt; Data, and add what is missing from Wowhead in two ways:
          </p>
          <div className="howto">
            <Figure
              src="onboarding/wowhead-bulk.png"
              alt="A Wowhead table with rows selected"
              caption={
                <>
                  <b>Items and recipes.</b> On any Wowhead Forever table (a profession's recipes, a search), select rows and copy them. Then on{' '}
                  <a href="#recipes">Recipes</a> or <a href="#items">Items</a>, open <b>Bulk import</b> and paste. Missing reagents come along.
                </>
              }
            >
              <WowheadTable
                head={['Name', 'Skill', 'Reagents']}
                rows={[
                  ['Bolt of Linen Cloth', '1', '2x Linen Cloth'],
                  ['Heavy Linen Gloves', '35', '2x Bolt of Linen Cloth, Coarse Thread'],
                  ['Linen Bag', '45', '3x Bolt of Linen Cloth, 3x Coarse Thread'],
                  ['Reinforced Linen Cape', '60', '2x Bolt of Linen Cloth, 3x Coarse Thread'],
                ]}
                selected={[1, 2]}
              />
            </Figure>
            <Figure
              src="onboarding/wowhead-vendor.png"
              alt="A vendor's Sells table on Wowhead with rows selected"
              caption={
                <>
                  <b>Vendor prices.</b> On a vendor's Wowhead Forever page, select rows in the <b>Sells</b> table and copy. On <a href="#items">Items</a>, open{' '}
                  <b>Vendor prices</b> and paste. Pick a vendor without a reputation discount.
                </>
              }
            >
              <WowheadTable
                head={['Name', 'Type', 'Cost']}
                rows={[
                  ['Coarse Thread', 'Trade Goods', '10c'],
                  ['Empty Vial', 'Trade Goods', '4c'],
                  ['Copper Rod', 'Trade Goods', '1s 30c'],
                  ['Maple Seed', 'Trade Goods', '2s'],
                ]}
                selected={[0, 1, 2]}
              />
            </Figure>
          </div>
          <p className="small muted">You can also paste a single Wowhead link or ID on Items or Recipes, and change any field by hand. Your changes survive a refresh.</p>
        </Step>

        <Step n={5} title="Settings and your data">
          <ul className="settings-list">
            <li>
              <a href="#settings/general">General</a>: the auction house rules (cut, deposits, how items are posted), which AH price workflows use, and time overheads.{' '}
              {config.ahRulesVerifiedAt ? (
                <span className="pos">Checked in game.</span>
              ) : (
                <span className="warn">The AH rules are placeholders until you check them in game.</span>
              )}
            </li>
            <li>
              <a href="#settings/data">Data</a>: refresh from Wowhead, export and import, and the danger zone.
            </li>
            <li>
              <a href="#settings/disenchant">Disenchant rules</a>: what disenchanting gives by quality and item level. Seeded, rarely edited.
            </li>
            <li>
              <a href="#settings/tutorials">Tutorials</a>: run the tours again.
            </li>
          </ul>
          <p>Your data is kept in three separate layers, so you can share one without the others:</p>
          <div className="layers">
            <Layer icon="person" title="Personal data">
              Workflows, flip favorites and ledger, min AH prices, settings. Yours only.
            </Layer>
            <Layer icon="coins" title="AH prices">
              Every AH price you record. Share with players on your realm: <b>Add pricing data</b> merges theirs into yours.
            </Layer>
            <Layer icon="book" title="Game data">
              Items, recipes, disenchant rules. Share with anyone. <b>Reset</b> brings back the starter set.
            </Layer>
          </div>
          <p className="warn small">
            Nothing leaves this browser unless you export it. Clearing site data loses it, so export all three in <a href="#settings/data">Settings &gt; Data</a> now
            and then. Importing personal or game data replaces what you have; adding AH prices never does.
          </p>
        </Step>

        <Step n={6} title="Still in beta">
          <p>
            This is a beta. The numbers are only as good as the data behind them: AH rules, disenchant chances and recipes may be off, and features, layouts and file
            formats can still change. Keep a backup, check anything important in game, and expect rough edges.
          </p>
        </Step>
      </ol>
    </div>
  );
}

function Step({ n, title, done = false, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className={`onboard-step ${done ? 'done' : ''}`}>
      <span className="onboard-n" aria-hidden>
        {done ? '✓' : n}
      </span>
      <section className="panel">
        <h2>{title}</h2>
        {children}
      </section>
    </li>
  );
}

const TOUR_PAGE: Record<TourId, string> = { workflow: 'Workflows', flip: 'AH flip' };

function TourStep({ n, tour, status, title, children }: { n: number; tour: TourId; status: TourStatus; title: string; children: ReactNode }) {
  const t = useTour();
  const running = t.onboarding.active?.tour === tour;
  return (
    <Step n={n} title={title} done={status === 'done'}>
      {children}
      <div className="add-row">
        {running ? (
          <>
            <a className="button primary" href={`#${tour === 'flip' ? 'flip' : 'workflows'}`}>
              Continue the tour
            </a>
            <button onClick={() => t.end(false)}>Stop the tour</button>
          </>
        ) : (
          <>
            <button className={status === 'done' ? '' : 'primary'} onClick={() => t.start(tour)}>
              {status === 'done' ? 'Take the tour again' : status === 'skipped' ? 'Start the tour' : `Start on ${TOUR_PAGE[tour]}`}
            </button>
            {status === 'new' && <button onClick={() => t.skip(tour)}>Skip for now</button>}
          </>
        )}
        {status === 'skipped' && !running && <span className="small muted">Skipped. Start it here or from Settings &gt; Tutorials.</span>}
        {status === 'done' && !running && <span className="small pos">Done</span>}
      </div>
    </Step>
  );
}

function Layer({ icon, title, children }: { icon: 'person' | 'coins' | 'book'; title: string; children: ReactNode }) {
  return (
    <div className="layer">
      <Icon name={icon} size={24} />
      <div>
        <b>{title}</b>
        <p className="small muted">{children}</p>
      </div>
    </div>
  );
}

/** A screenshot from public/, or the drawn illustration when there is none. */
function Figure({ src, alt, caption, children }: { src: string; alt: string; caption: ReactNode; children: ReactNode }) {
  const [missing, setMissing] = useState(false);
  return (
    <figure className="howto-fig">
      {missing ? children : <img src={src} alt={alt} onError={() => setMissing(true)} />}
      <figcaption className="small">{caption}</figcaption>
    </figure>
  );
}

/** A drawing of a Wowhead table with some rows selected, as they look while being copied. */
function WowheadTable({ head, rows, selected }: { head: string[]; rows: string[][]; selected: number[] }) {
  return (
    <div className="wh-mock" aria-hidden>
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={selected.includes(i) ? 'sel' : ''}>
              {r.map((c, k) => (
                <td key={k} className={k === 0 ? 'wh-link' : ''}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="wh-keys">Ctrl + C</span>
    </div>
  );
}
