import { useRef, useState } from 'react';
import { DEFAULT_CONFIG } from '../config';
import type { DbKind } from '../db/repo';
import type { AhDuration, Config } from '../engine/types';
import { refreshStale } from '../state/importer';
import { useStore } from '../state/store';
import { errorText, MoneyInput, NumberInput, Panel } from './common';

const FILE_NAME: Record<DbKind, string> = { data: 'gamedata', user: 'personal' };
const KIND_LABEL: Record<DbKind, string> = { data: 'game data', user: 'personal data' };

const pct = (x: number) => Math.round(x * 10000) / 100;

export function SettingsPage() {
  const { config, mutate, mutateAsync, exportDb, importDb } = useStore();
  const save = (patch: Partial<Config>) => mutate((repo) => repo.saveConfig({ ...config, ...patch }));
  const setDuration = (i: number, patch: Partial<AhDuration>) => save({ durations: config.durations.map((d, k) => (k === i ? { ...d, ...patch } : d)) });

  const fileRef = useRef<HTMLInputElement>(null);
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(30);
  const [progress, setProgress] = useState<string | null>(null);

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
      <Panel title="Auction house" actions={<button onClick={() => save({ ahCut: DEFAULT_CONFIG.ahCut, durations: DEFAULT_CONFIG.durations, minDeposit: DEFAULT_CONFIG.minDeposit })}>Reset to defaults</button>}>
        <p className="small warn">Defaults are Classic based placeholders. Verify them in WoW Forever.</p>
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
          </tbody>
        </table>
        <p className="small muted">Deposit is a percentage of the item's vendor sell price per listing.</p>
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
          Everything is stored in this browser as two SQLite databases. <b>Game data</b> (items, recipes, disenchant rules)
          can be shared with other players. <b>Personal data</b> (workflows, flip favorites, prices, settings) is yours.
          Export both for backups or to move to another machine. Importing a file replaces only the data it holds.
        </p>
        <div className="add-row">
          <button onClick={() => download('data')}>Export game data</button>
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
                setDataMsg(`Imported ${kinds.map((k) => KIND_LABEL[k]).join(' and ')} from ${file.name}.`);
              } catch (err) {
                setDataMsg(`Import failed: ${errorText(err)}`);
              }
            }}
          />
          {dataMsg && <span className="small muted">{dataMsg}</span>}
        </div>
      </Panel>
    </div>
  );
}
