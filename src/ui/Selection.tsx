import { useState } from 'react';

/** Row selection for list pages. */
export function useSelection<K>() {
  const [selected, setSelected] = useState<Set<K>>(new Set());
  return {
    selected,
    has: (k: K) => selected.has(k),
    toggle: (k: K, on: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (on) next.add(k);
        else next.delete(k);
        return next;
      }),
    setAll: (keys: K[], on: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
        return next;
      }),
    clear: () => setSelected(new Set()),
  };
}

/** Header checkbox that selects or clears every visible row. */
export function SelectAll<K>({ keys, sel }: { keys: K[]; sel: ReturnType<typeof useSelection<K>> }) {
  const all = keys.length > 0 && keys.every((k) => sel.has(k));
  return <input type="checkbox" aria-label="Select all" checked={all} disabled={keys.length === 0} onChange={(e) => sel.setAll(keys, e.target.checked)} />;
}

export function SelectionBar({ count, onDelete, onClear }: { count: number; onDelete: () => void; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div className="selection-bar">
      <span className="small">{count} selected</span>
      <button className="danger" onClick={onDelete}>
        Delete selected
      </button>
      <button className="link-btn" onClick={onClear}>
        clear
      </button>
    </div>
  );
}
