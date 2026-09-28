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

/** Row actions: yellow pencil to edit (lit while the editor is open), red cross to delete. */
export function RowActions({ name, editing, onEdit, onDelete }: { name: string; editing: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="row-actions">
      <button
        className={`row-icon edit ${editing ? 'on' : ''}`}
        onClick={onEdit}
        title={editing ? 'Close editor' : 'Edit'}
        aria-label={editing ? `Close editor for ${name}` : `Edit ${name}`}
        aria-pressed={editing}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M11.3 1.7a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L5.6 13.4 2 14l.6-3.6 8.7-8.7Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M9.8 3.2l3 3" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <button className="row-icon delete" onClick={onDelete} title="Delete" aria-label={`Delete ${name}`}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  );
}
