import { useRef, useState } from 'react';

/** The parts of an item or recipe record that its editor changes. */
interface Editable<F> {
  source: 'wowhead' | 'manual';
  imported: F;
  overrides: Partial<F>;
}

type Draft<F> = { imported: F; overrides: Partial<F> };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One open editor per list, with explicit save. The draft holds only what the editor changes:
 * overrides, plus base values for hand-made records. Saving merges it onto the latest stored record,
 * so prices edited in the row meanwhile, or a "Refresh from Wowhead", are never overwritten.
 */
export function useEditSession<K, R extends Editable<F>, F>(
  records: R[],
  idOf: (r: R) => K,
  persist: (record: R) => void,
) {
  const [editing, setEditing] = useState<K | null>(null);
  const [draft, setDraft] = useState<Draft<F> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const latest = editing === null ? undefined : records.find((r) => idOf(r) === editing);
  const merge = (r: R, d: Draft<F> | null): R =>
    d ? { ...r, overrides: d.overrides, imported: r.source === 'manual' ? d.imported : r.imported } : r;
  const working = latest ? merge(latest, draft) : undefined;
  const dirty = !!latest && !!draft && (!same(draft.overrides, latest.overrides) || (latest.source === 'manual' && !same(draft.imported, latest.imported)));

  const reset = () => {
    setEditing(null);
    setDraft(null);
  };
  const confirmDiscard = () => !dirty || confirm('Discard your unsaved changes?');

  return {
    editing,
    /** The record as it would be saved, for the editor to show. */
    working,
    dirty,
    /** Apply an edit to the draft. */
    update: (fn: (w: R) => R) => {
      if (!latest) return;
      const next = fn(merge(latest, draftRef.current));
      const d = { imported: next.imported, overrides: next.overrides };
      draftRef.current = d;
      setDraft(d);
    },
    open: (id: K) => {
      if (id === editing || !confirmDiscard()) return;
      const r = records.find((x) => idOf(x) === id);
      setEditing(id);
      setDraft(r ? { imported: r.imported, overrides: r.overrides } : null);
    },
    save: () => {
      // Read the ref: an input's blur may have updated the draft in this same click.
      const r = editing === null ? undefined : records.find((x) => idOf(x) === editing);
      if (r && draftRef.current) persist({ ...merge(r, draftRef.current), updatedAt: Date.now() } as R);
      reset();
    },
    /** Close and discard the draft. Clicking Cancel is the confirmation, so no prompt. */
    cancel: reset,
    /** Close without saving after the record was deleted. */
    drop: reset,
  };
}
