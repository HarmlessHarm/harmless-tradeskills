import { useRef, useState } from 'react';
import { DEFAULT_CONFIG } from '../config';
import type { DbKind } from '../db/repo';
import type { AhDuration, Config, ItemClass } from '../engine/types';
import { refreshStale } from '../state/importer';
import { useStore } from '../state/store';
import { errorText, MoneyInput, NumberInput, Panel, Segmented } from './common';
import { DisenchantPage } from './DisenchantPage';

const FILE_NAME: Record<DbKind, string> = { data: 'gamedata', user: 'personal', prices: 'prices' };
const KIND_LABEL: Record<DbKind, string> = { data: 'game data', user: 'personal data', prices: 'AH prices' };
const KIND_CONTENTS: Record<DbKind, string> = {
  data: 'items, recipes, disenchant rules',
  user: 'workflows, workflow prices, flip favorites, settings',
  prices: 'AH price snapshots',
};

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
  { key: 'general', label: 'General', sub: 'Auction house, time', Section: GeneralSettings },
  { key: 'data', label: 'Data', sub: 'Wowhead, backups', Section: DataSettings },
  { key: 'disenchant', label: 'Disenchant rules', sub: 'Seeded, rarely edited', Section: DisenchantPage },
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
  const { mutateAsync, exportDb, importDb, clearDb } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(30);
  const [progress, setProgress] = useState<string | null>(null);
  const [clearMsg, setClearMsg] = useState<string | null>(null);

  const clear = async (kinds: DbKind[]) => {
    const what = listText(kinds.map((k) => `${KIND_LABEL[k]} (${KIND_CONTENTS[k]})`));
    if (!confirm(`Delete all ${what} in this browser? This cannot be undone. Export first if you want a backup.`)) return;
    try {
      await clearDb(kinds);
      setClearMsg(`Cleared ${listText(kinds.map((k) => KIND_LABEL[k]))}.`);
    } catch (err) {
      setClearMsg(`Clearing failed: ${errorText(err)}`);
    }
  };

  const download = (kind: DbKind) => {
    const bytes = exportDb(kind);
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
          Everything is stored in this browser as three SQLite databases. <b>Game data</b> (items, recipes, disenchant rules)
          can be shared with other players. <b>AH prices</b> (price snapshots for flipping) can be shared with players on your
          realm. <b>Personal data</b> (workflows, workflow prices, flip favorites, settings) is yours. Export all three for backups
          or to move to another machine. Importing a file replaces only the data it holds.
        </p>
        <div className="add-row">
          <button onClick={() => download('data')}>Export game data</button>
          <button onClick={() => download('prices')}>Export AH prices</button>
          <button onClick={() => download('user')}>Export personal data</button>
          <button onClick={() => fileRef.current?.click()}>Import .sqlite</button>
          <input
            ref={fileRef}
            type="file"
            accept=".sqlite,.db,application/vnd.sqlite3,application/x-sqlite3"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (!confirm('Replace the data in this browser with the data in the imported file?')) return;
              try {
                const kinds = await importDb(new Uint8Array(await file.arrayBuffer()));
                setDataMsg(`Imported ${listText(kinds.map((k) => KIND_LABEL[k]))} from ${file.name}.`);
              } catch (err) {
                setDataMsg(`Import failed: ${errorText(err)}`);
              }
            }}
          />
          {dataMsg && <span className="small muted">{dataMsg}</span>}
        </div>
      </Panel>

      <Panel title="Danger zone" className="danger-zone">
        <p className="small muted">
          Permanently delete data stored in this browser. Disenchant rules and settings go back to their defaults.
        </p>
        <div className="add-row">
          <button className="danger" onClick={() => clear(['data'])}>Clear game data</button>
          <button className="danger" onClick={() => clear(['prices'])}>Clear AH prices</button>
          <button className="danger" onClick={() => clear(['user'])}>Clear personal data</button>
          <button className="danger" onClick={() => clear(['data', 'prices', 'user'])}>Clear all data</button>
          {clearMsg && <span className="small muted">{clearMsg}</span>}
        </div>
      </Panel>
    </div>
  );
}
