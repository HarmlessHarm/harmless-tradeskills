import { useState, type ClipboardEvent } from 'react';
import { bulkImport, type BulkResult } from '../state/importer';
import { useStore } from '../state/store';
import { professionOptions } from '../professions';
import { extractProfessions, extractWowheadRefs, withoutProfessionSpells, type PastedRef } from '../wowhead/adapter';
import { errorText } from './common';

const key = (r: PastedRef) => `${r.type}:${r.id}`;

/**
 * Select rows in any Wowhead Forever table (a profession's recipe list, a search result), copy,
 * and paste here. Every item and spell link in the selection is offered for import.
 */
export function BulkImport({ onClose }: { onClose: () => void }) {
  const { itemRecords, recipeRecords, mutateAsync } = useStore();
  const [refs, setRefs] = useState<PastedRef[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [force, setForce] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [profession, setProfession] = useState('');

  const known = (r: PastedRef) =>
    r.type === 'spell' ? recipeRecords.some((x) => x.spellId === r.id) : itemRecords.some((x) => x.id === r.id);

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    // A selection from one profession's recipe list names that profession; use it as the default.
    const profs = extractProfessions(html);
    const found = withoutProfessionSpells(extractWowheadRefs(html, e.clipboardData.getData('text/plain')), profs);
    setProfession(profs.length === 1 ? profs[0] : '');
    setRefs(found);
    setResult(null);
    setPicked(new Set(found.map(key)));
    setHint(found.length ? null : 'No Wowhead item or recipe links found in that paste. Select table rows on a Wowhead page and copy them.');
  };

  const toggleType = (type: PastedRef['type'], on: boolean) => {
    const next = new Set(picked);
    refs.filter((r) => r.type === type).forEach((r) => (on ? next.add(key(r)) : next.delete(key(r))));
    setPicked(next);
  };

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const chosen = refs.filter((r) => picked.has(key(r)));
      const res = await mutateAsync((repo) => bulkImport(repo, chosen, { force, profession: profession.trim() || null }, (d, t) => setProgress(`${d} of ${t}`)));
      setResult(res);
    } catch (e) {
      setResult({ imported: 0, skipped: 0, tagged: 0, errors: [errorText(e)], warnings: [] });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const spells = refs.filter((r) => r.type === 'spell');
  const items = refs.filter((r) => r.type === 'item');
  const chosenCount = refs.filter((r) => picked.has(key(r)) && (force || !known(r))).length;
  const pickedSpells = spells.filter((r) => picked.has(key(r))).length;
  const tagOnly = chosenCount === 0 && pickedSpells > 0 && profession.trim() !== '';

  const list = (title: string, type: PastedRef['type'], rows: PastedRef[]) =>
    rows.length > 0 && (
      <div className="bulk-group">
        <label className="inline small">
          <input type="checkbox" checked={rows.every((r) => picked.has(key(r)))} onChange={(e) => toggleType(type, e.target.checked)} />
          <strong>
            {title} ({rows.length})
          </strong>
        </label>
        <ul className="bulk-list">
          {rows.map((r) => (
            <li key={key(r)}>
              <label className="inline small">
                <input
                  type="checkbox"
                  checked={picked.has(key(r))}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(key(r));
                    else next.delete(key(r));
                    setPicked(next);
                  }}
                />
                {r.name ?? <span className="muted">unnamed</span>} <span className="muted">#{r.id}</span>
                {known(r) && <span className="badge">have it</span>}
              </label>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="bulk-section">
      <div className="bulk-head">
        <h3>Bulk import from Wowhead</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <p className="small muted">
        On a Wowhead Forever page, select rows in a table (for example a profession's recipe list) and copy them. Paste below. Recipes also import
        their reagents and created item.
      </p>
      <textarea className="paste-zone" rows={3} placeholder="Paste here (Ctrl+V)" onPaste={onPaste} value="" onChange={() => {}} />
      {hint && <p className="small warn">{hint}</p>}
      {refs.length > 0 && (
        <>
          <div className="bulk-groups">
            {list('Recipes', 'spell', spells)}
            {list('Items', 'item', items)}
          </div>
          <div className="add-row">
            {spells.length > 0 && (
              <label className="inline small">
                Profession for these recipes
                <input
                  className="short-input"
                  list="bulk-professions"
                  value={profession}
                  placeholder="none"
                  onChange={(e) => setProfession(e.target.value)}
                />
                <datalist id="bulk-professions">
                  {professionOptions(recipeRecords.map((r) => r.imported.profession)).map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
            )}
            <label className="inline small">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              Re-import ones I already have (keeps my edits)
            </label>
            <button disabled={running || (chosenCount === 0 && !tagOnly)} onClick={run}>
              {running ? `Importing ${progress ?? ''}` : tagOnly ? `Set profession on ${pickedSpells}` : `Import ${chosenCount}`}
            </button>
          </div>
        </>
      )}
      {result && (
        <div className="small">
          <p>
            Imported {result.imported}
            {result.skipped > 0 && `, skipped ${result.skipped} already in the catalog`}
            {result.tagged > 0 && `, set the profession on ${result.tagged} recipe${result.tagged === 1 ? '' : 's'}`}
            {result.errors.length > 0 && `, ${result.errors.length} failed`}.
          </p>
          {[...result.errors, ...result.warnings].map((m, i) => (
            <p key={i} className="warn">
              {m}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
