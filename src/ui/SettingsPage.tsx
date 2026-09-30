import { useRef, useState } from 'react';
import { DEFAULT_CONFIG } from '../config';
import type { DbKind } from '../db/repo';
import type { AhDuration, AhPriceRule, Config, ItemClass } from '../engine/types';
import { checkFileKind } from '../db/browser';
import { refreshStale } from '../state/importer';
import { useStore } from '../state/store';
import { errorText, MoneyInput, NumberInput, Panel, Segmented } from './common';
import { DisenchantPage } from './DisenchantPage';
import { Icon, type IconName } from './icons';
import { useTour } from './tour/Tour';
import type { TourId } from '../db/repo';

const FILE_NAME: Record<DbKind, string> = { data: 'gamedata', user: 'personal', prices: 'prices' };
const KIND_LABEL: Record<DbKind, string> = { data: 'game data', user: 'personal data', prices: 'AH prices' };
const KIND_CONTENTS: Record<DbKind, string> = {
  data: 'items, recipes, disenchant rules',
  user: 'workflows, flip favorites and ledger, min AH prices, settings',
  prices: 'AH price snapshots for workflows, items and flips',
};

/** The three databases on the Data page, in this order (DEC-21, DEC-23, DEC-28). */
const DATA_CARDS: { kind: DbKind; icon: IconName; title: string; noun: string; holds: string }[] = [
  { kind: 'user', icon: 'person', title: 'Personal data', noun: 'personal data', holds: 'Workflows, flip favorites and ledger, min AH prices, settings. Yours only.' },
  { kind: 'prices', icon: 'coins', title: 'AH prices', noun: 'AH prices', holds: 'Every AH price you record. Share with players on your realm.' },
  { kind: 'data', icon: 'book', title: 'Game data', noun: 'game data', holds: 'Items, recipes, disenchant rules. Share with anyone.' },
];

/** "a", "a and b", "a, b and c". */
const listText = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

const pct = (x: number) => Math.round(x * 10000) / 100;

const ITEM_CLASSES: { key: ItemClass; label: string }[] = [
  { key: 'armor', label: 'Armor' },
  { key: 'weapon', label: 'Weapons' },
  { key: 'other', label: 'Everything else' },
];

/** The AH rules that "Reset to defaults" restores. */
const AH_DEFAULTS: Partial<Config> = {
  ahCut: DEFAULT_CONFIG.ahCut,
  durations: DEFAULT_CONFIG.durations,
  minDeposit: DEFAULT_CONFIG.minDeposit,
  depositRefundedOnSale: DEFAULT_CONFIG.depositRefundedOnSale,
  listingMode: DEFAULT_CONFIG.listingMode,
};

const SECTIONS = [
  { key: 'general', label: 'General', sub: 'Auction house, prices, time', Section: GeneralSettings },
  { key: 'data', label: 'Data', sub: 'Wowhead, backups', Section: DataSettings },
  { key: 'disenchant', label: 'Disenchant rules', sub: 'Seeded, rarely edited', Section: DisenchantPage },
  { key: 'tutorials', label: 'Tutorials', sub: 'Guided tours', Section: TutorialSettings },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

export function SettingsPage({ sub }: { sub?: string }) {
  const section: SectionKey = SECTIONS.find((s) => s.key === sub)?.key ?? 'general';
  const { Section } = SECTIONS.find((s) => s.key === section)!;

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h2>Settings</h2>
        </div>
        <ul className="wf-list">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <a className={`wf-item ${s.key === section ? 'on' : ''}`} href={`#settings/${s.key}`}>
                <span className="wf-name">{s.label}</span>
                <span className="wf-sub muted">{s.sub}</span>
              </a>
            </li>
          ))}
        </ul>
      </aside>
      <div className="main">
        <Section />
      </div>
    </div>
  );
}

function GeneralSettings() {
  const { config, mutate } = useStore();
  const save = (patch: Partial<Config>) => mutate((repo) => repo.saveConfig({ ...config, ...patch }));
  const setDuration = (i: number, patch: Partial<AhDuration>) => save({ durations: config.durations.map((d, k) => (k === i ? { ...d, ...patch } : d)) });
  const verifiedAt = config.ahRulesVerifiedAt;

  return (
    <div className="stack narrow">
      <Panel
        title="Auction house"
        actions={
          <>
            <button onClick={() => save({ ahRulesVerifiedAt: Date.now() })}>{verifiedAt ? 'Checked again today' : 'Mark as checked in game'}</button>
            <button onClick={() => save({ ...AH_DEFAULTS, ahRulesVerifiedAt: null })}>Reset to defaults</button>
          </>
        }
      >
        {verifiedAt ? (
          <p className="small muted">Checked in game on {new Date(verifiedAt).toLocaleDateString()}.</p>
        ) : (
          <p className="small warn">
            Not checked yet. Defaults are placeholders: Classic based rates, and the modern AH listing rules (commodities as one lot, gear per piece). Verify them in WoW
            Forever, then mark them as checked.
          </p>
        )}
        <table className="form-table">
          <thead>
            <tr>
              <th />
              <th>Faction AH</th>
              <th>Neutral AH</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Cut on sale %</th>
              <td>
                <NumberInput value={pct(config.ahCut.faction)} step={0.1} min={0} onChange={(v) => save({ ahCut: { ...config.ahCut, faction: (v ?? 0) / 100 } })} />
              </td>
              <td>
                <NumberInput value={pct(config.ahCut.neutral)} step={0.1} min={0} onChange={(v) => save({ ahCut: { ...config.ahCut, neutral: (v ?? 0) / 100 } })} />
              </td>
            </tr>
            {config.durations.map((d, i) => (
              <tr key={i}>
                <th>
                  Deposit % for <input className="short" value={d.label} onChange={(e) => setDuration(i, { label: e.target.value })} />
                </th>
                <td>
                  <NumberInput value={pct(d.depositRate.faction)} step={0.1} min={0} onChange={(v) => setDuration(i, { depositRate: { ...d.depositRate, faction: (v ?? 0) / 100 } })} />
                </td>
                <td>
                  <NumberInput value={pct(d.depositRate.neutral)} step={0.1} min={0} onChange={(v) => setDuration(i, { depositRate: { ...d.depositRate, neutral: (v ?? 0) / 100 } })} />
                </td>
              </tr>
            ))}
            <tr>
              <th>Minimum deposit</th>
              <td colSpan={2}>
                <MoneyInput value={config.minDeposit} allowEmpty={false} onChange={(v) => save({ minDeposit: v ?? 0 })} />
              </td>
            </tr>
            <tr>
              <th>Deposit on sale</th>
              <td colSpan={2}>
                <Segmented
                  value={config.depositRefundedOnSale ? 'refunded' : 'kept'}
                  options={[
                    { value: 'refunded', label: 'Refunded' },
                    { value: 'kept', label: 'Kept by the AH' },
                  ]}
                  onChange={(v) => save({ depositRefundedOnSale: v === 'refunded' })}
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="small muted">Deposit is a percentage of the vendor sell price of everything in the auction, with a minimum per auction. It is always lost when the auction expires.</p>
        <h3>How items are posted</h3>
        <table className="form-table">
          <tbody>
            {ITEM_CLASSES.map(({ key, label }) => (
              <tr key={key}>
                <th>{label}</th>
                <td>
                  <Segmented
                    value={config.listingMode[key]}
                    options={[
                      { value: 'lot', label: 'One auction per lot' },
                      { value: 'perItem', label: 'One auction per piece' },
                    ]}
                    onChange={(v) => save({ listingMode: { ...config.listingMode, [key]: v } })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          One auction per lot: the whole quantity is one auction with one deposit, and buyers take any number (commodities on the modern AH). One auction per piece:
          every item is its own auction with its own deposit and minimum deposit.
        </p>
      </Panel>

      <Panel title="AH prices">
        <div className="inline-field">
          <span>Workflows and items use</span>
          <Segmented<AhPriceRule>
            label="Workflows and items use"
            value={config.ahPriceRule}
            options={[
              { value: 'latest', label: 'Latest price' },
              { value: 'typical', label: 'Typical price' },
            ]}
            onChange={(v) => save({ ahPriceRule: v })}
          />
        </div>
        <p className="small muted">
          Every AH price you record is a price snapshot, per faction or neutral AH. <b>Latest</b> uses the newest one (its market value): what you just saw.{' '}
          <b>Typical</b> uses the typical price over all of them, so one odd low or high does not swing a workflow. The min AH price stays a number you set.
        </p>
      </Panel>

      <Panel title="Time and simulation">
        <div className="form-grid">
          <label>
            Overhead per action (s)
            <NumberInput value={config.perActionOverheadSec} step={0.1} min={0} onChange={(v) => save({ perActionOverheadSec: v ?? 0 })} />
          </label>
          <label>
            Overhead per batch (s)
            <NumberInput value={config.perBatchOverheadSec} step={1} min={0} onChange={(v) => save({ perBatchOverheadSec: v ?? 0 })} />
          </label>
          <label>
            Default batch size
            <NumberInput value={config.defaultBatchSize} step={1} min={1} onChange={(v) => save({ defaultBatchSize: Math.max(1, v ?? 1) })} />
          </label>
          <label>
            Simulated batches
            <NumberInput value={config.simulationRuns} step={500} min={100} onChange={(v) => save({ simulationRuns: Math.max(100, v ?? 100) })} />
          </label>
          <label>
            Disenchant cast time (s)
            <NumberInput value={config.disenchantCastMs / 1000} step={0.1} min={0} onChange={(v) => save({ disenchantCastMs: Math.round((v ?? 0) * 1000) })} />
          </label>
        </div>
        <p className="small muted">Per-action overhead is idle time between casts. Per-batch overhead covers vendor walks, buying and posting.</p>
      </Panel>
    </div>
  );
}

function DataSettings() {
  const { mutate, mutateAsync, exportDb, importDb, addPrices, clearDb } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  /** What the file picker is for: replace game or personal data, or add AH prices. */
  const importMode = useRef<'data' | 'user' | 'addPrices'>('data');
  const pick = (mode: typeof importMode.current) => {
    importMode.current = mode;
    fileRef.current?.click();
  };
  const onFile = async (file: File) => {
    const mode = importMode.current;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      if (mode === 'addPrices') {
        const { added, skipped } = await addPrices(bytes, file.name);
        setDataMsg(
          `Added ${added} AH price${added === 1 ? '' : 's'} from ${file.name}${skipped ? ` (${skipped} you already had)` : ''}. Your own prices are unchanged.`,
        );
        return;
      }
      await checkFileKind(bytes, mode);
      const what = mode === 'data' ? 'game data (items, recipes, disenchant rules)' : 'personal data (workflows, flip favorites and ledger, min AH prices, settings)';
      if (!confirm(`Replace the ${what} in this browser with ${file.name}? Export first if you want a backup.`)) return;
      const kinds = await importDb(bytes, mode);
      setDataMsg(`Imported ${listText(kinds.map((k) => KIND_LABEL[k]))} from ${file.name}.`);
    } catch (err) {
      setDataMsg(`Import failed: ${errorText(err)}`);
    }
  };
  const removeAdded = () => {
    if (!confirm('Remove every AH price you added from other players? Your own prices stay.')) return;
    const n = mutate((repo) => repo.removeAddedSnapshots());
    setClearMsg(`Removed ${n} added AH price${n === 1 ? '' : 's'}.`);
  };
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(30);
  const [progress, setProgress] = useState<string | null>(null);
  const [clearMsg, setClearMsg] = useState<string | null>(null);

  /** Reset puts game data back to the starter set, clear leaves it empty. Other data is emptied either way. */
  const clear = async (kinds: DbKind[], reset = false) => {
    const what = listText(kinds.map((k) => `${KIND_LABEL[k]} (${KIND_CONTENTS[k]})`));
    const after = kinds.includes('data') ? (reset ? ' Game data goes back to the starter set.' : ' Game data is left empty.') : '';
    if (!confirm(`Delete all ${what} in this browser?${after} This cannot be undone. Export first if you want a backup.`)) return;
    try {
      await clearDb(kinds, reset);
      setClearMsg(`${reset ? 'Reset' : 'Cleared'} ${listText(kinds.map((k) => KIND_LABEL[k]))}.`);
    } catch (err) {
      setClearMsg(`${reset ? 'Resetting' : 'Clearing'} failed: ${errorText(err)}`);
    }
  };

  const download = async (kind: DbKind) => {
    const bytes = await exportDb(kind);
    const blob = new Blob([bytes.slice().buffer], { type: 'application/vnd.sqlite3' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `harmless-tradeskills-${FILE_NAME[kind]}-${new Date().toISOString().slice(0, 10)}.sqlite`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack narrow">
      <Panel title="Wowhead data">
        <p className="small muted">Items and recipes are fetched once and cached. Refresh records older than a number of days, one request at a time.</p>
        <div className="add-row">
          <span className="small">Older than</span>
          <NumberInput value={days} min={0} step={1} onChange={setDays} />
          <span className="small">days</span>
          <button
            disabled={progress !== null && !progress.startsWith('Done')}
            onClick={async () => {
              setProgress('Starting...');
              try {
                const errors = await mutateAsync((repo) => refreshStale(repo, (days ?? 0) * 86_400_000, (d, t) => setProgress(`${d} of ${t}`)));
                setProgress(`Done.${errors.length ? ` ${errors.length} failed: ${errors.join(' ')}` : ''}`);
              } catch (e) {
                setProgress(`Done. Failed: ${errorText(e)}`);
              }
            }}
          >
            Refresh
          </button>
          {progress && <span className="small muted">{progress}</span>}
        </div>
      </Panel>

      <Panel title="Your data">
        <p className="small muted">
          Everything is stored in this browser as three SQLite databases. Export all three for backups or to move to another machine. Game data exports leave out the saved Wowhead tooltips.
        </p>
        <div className="data-kinds">
          {DATA_CARDS.map((c) => (
            <section key={c.kind} className="data-kind" aria-labelledby={`data-kind-${c.kind}`}>
              <span className="data-kind-icon">
                <Icon name={c.icon} size={32} />
              </span>
              <h3 id={`data-kind-${c.kind}`}>{c.title}</h3>
              <p className="small muted">{c.holds}</p>
              <button onClick={() => download(c.kind)}>
                <Icon name="download" /> Export {c.noun}
              </button>
              <button onClick={() => pick(c.kind === 'prices' ? 'addPrices' : c.kind)}>
                <Icon name={c.kind === 'prices' ? 'plus' : 'upload'} /> {c.kind === 'prices' ? 'Add pricing data' : `Import ${c.noun}`}
              </button>
            </section>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".sqlite,.db,application/vnd.sqlite3,application/x-sqlite3"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void onFile(file);
          }}
        />
        {dataMsg && <p className="small muted">{dataMsg}</p>}
        <p className="small muted">
          <b>Import</b> game or personal data replaces what this browser has: use it to restore a backup or move machines.{' '}
          <b>Add pricing data</b> adds another player's AH prices to yours: none of your prices is replaced, prices you already have are skipped
          (adding the same file twice adds nothing), and other players' prices are marked as shared. It also restores your own AH prices
          export: those come back as yours. Each button only takes its own kind of file.
        </p>
      </Panel>

      <Panel title="Danger zone" className="danger-zone">
        <p className="small muted">
          Permanently delete data stored in this browser. <b>Reset</b> puts game data back to the starter set (professions 1 to 150). <b>Clear</b> leaves it
          empty. Disenchant rules and settings go back to their defaults either way.
        </p>
        <table className="form-table danger-table">
          <tbody>
            <tr>
              <th>Game data</th>
              <td>
                <button className="danger" onClick={() => clear(['data'], true)}>Reset game data</button>
                <button className="danger" onClick={() => clear(['data'])}>Clear game data</button>
              </td>
            </tr>
            <tr>
              <th>AH prices</th>
              <td>
                <button className="danger" onClick={removeAdded}>Remove added prices</button>
                <button className="danger" onClick={() => clear(['prices'])}>Clear AH prices</button>
              </td>
            </tr>
            <tr>
              <th>Personal data</th>
              <td>
                <button className="danger" onClick={() => clear(['user'])}>Clear personal data</button>
              </td>
            </tr>
            <tr>
              <th>Everything</th>
              <td>
                <button className="danger" onClick={() => clear(['data', 'prices', 'user'], true)}>Reset all data</button>
                <button className="danger" onClick={() => clear(['data', 'prices', 'user'])}>Clear all data</button>
              </td>
            </tr>
          </tbody>
        </table>
        {clearMsg && <p className="small muted">{clearMsg}</p>}
      </Panel>
    </div>
  );
}

const TUTORIALS: { tour: TourId; title: string; about: string }[] = [
  { tour: 'workflow', title: 'Build a workflow', about: 'Builds the DE shuffle step by step on the Workflows page, and explains the results, units, batches and prices.' },
  { tour: 'flip', title: 'The AH flipper', about: 'Favorites and workflow items, the quick calculator, the AH price tracker and the ledger.' },
];

function TutorialSettings() {
  const t = useTour();
  return (
    <div className="stack narrow">
      <Panel title="Tutorials">
        <p className="small muted">
          Guided tours that point at the real controls: do what a step asks and it moves on. Close one any time. The <a href="#start">Get started</a> page has
          the full introduction.
        </p>
        <table className="form-table tutorials">
          <tbody>
            <tr>
              <th>
                Get started walkthrough
                <span className={`small ${t.onboarding.completed ? 'pos' : 'muted'}`}> {t.onboarding.completed ? 'complete' : 'not complete'}</span>
                <p className="small muted">The whole introduction: starter data, both tours, keeping data fresh, settings and backups. Starting over resets both tours too.</p>
              </th>
              <td>
                {t.onboarding.completed ? (
                  <button onClick={() => confirm('Start the Get started walkthrough over? Your workflows and data stay as they are.') && t.restartWalkthrough()}>
                    Start over
                  </button>
                ) : (
                  <a className="button" href="#start">
                    Open
                  </a>
                )}
              </td>
            </tr>
            {TUTORIALS.map(({ tour, title, about }) => {
              const status = t.onboarding.tours[tour];
              return (
                <tr key={tour}>
                  <th>
                    {title}
                    <span className={`small ${status === 'done' ? 'pos' : 'muted'}`}> {status === 'done' ? 'done' : status === 'skipped' ? 'skipped' : 'not started'}</span>
                    <p className="small muted">{about}</p>
                  </th>
                  <td>
                    <button onClick={() => t.start(tour)}>{t.onboarding.active?.tour === tour ? 'Restart' : status === 'new' ? 'Start' : 'Start again'}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
