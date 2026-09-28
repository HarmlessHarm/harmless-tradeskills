import { useRef, useState, type ReactNode } from 'react';

/**
 * Set every key between the anchor and the target (inclusive, in display order) to `on`.
 * Falls back to just the target when the anchor is no longer visible.
 */
export function selectRange<K>(prev: Set<K>, keys: K[], anchor: K | null, target: K, on: boolean): Set<K> {
  const next = new Set(prev);
  const a = anchor === null ? -1 : keys.indexOf(anchor);
  const b = keys.indexOf(target);
  const [from, to] = a < 0 || b < 0 ? [b, b] : [Math.min(a, b), Math.max(a, b)];
  for (let i = from; i <= to && i >= 0; i++) {
    if (on) next.add(keys[i]);
    else next.delete(keys[i]);
  }
  if (b < 0) {
    if (on) next.add(target);
    else next.delete(target);
  }
  return next;
}

/** Row selection for list pages. Shift-click selects or clears a range, like a file manager. */
export function useSelection<K>() {
  const [selected, setSelected] = useState<Set<K>>(new Set());
  const anchor = useRef<K | null>(null);
  return {
    selected,
    has: (k: K) => selected.has(k),
    toggle: (k: K, on: boolean) => {
      anchor.current = k;
      setSelected((prev) => selectRange(prev, [k], null, k, on));
    },
    /** A row checkbox click; with shift, applies to every visible row since the last click. */
    click: (k: K, on: boolean, shift: boolean, visibleKeys: K[]) => {
      const from = shift ? anchor.current : null;
      anchor.current = k;
      setSelected((prev) => selectRange(prev, visibleKeys, from, k, on));
    },
    setAll: (keys: K[], on: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
        return next;
      }),
    clear: () => {
      anchor.current = null;
      setSelected(new Set());
    },
  };
}

/** A row's checkbox. React fires checkbox onChange from the click, so the shift key is readable. */
export function RowCheckbox<K>({ k, label, visibleKeys, sel }: { k: K; label: string; visibleKeys: K[]; sel: ReturnType<typeof useSelection<K>> }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={sel.has(k)}
      onChange={(e) => sel.click(k, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true, visibleKeys)}
    />
  );
}

/** Header checkbox that selects or clears every visible row. */
export function SelectAll<K>({ keys, sel }: { keys: K[]; sel: ReturnType<typeof useSelection<K>> }) {
  const all = keys.length > 0 && keys.every((k) => sel.has(k));
  return <input type="checkbox" aria-label="Select all" checked={all} disabled={keys.length === 0} onChange={(e) => sel.setAll(keys, e.target.checked)} />;
}

/** Actions for the selected rows. Pages add their own bulk edits as children. */
export function SelectionBar({ count, onDelete, onClear, children }: { count: number; onDelete: () => void; onClear: () => void; children?: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="selection-bar">
      <span className="small">{count} selected</span>
      {children}
      <button className="danger" onClick={onDelete}>
        Delete selected
      </button>
      <button className="link-btn" onClick={onClear}>
        clear
      </button>
    </div>
  );
}

/** Row actions: yellow pencil opens the editor; while open it becomes a green checkmark that saves. Red cross deletes. */
export function RowActions({
  name,
  editing,
  dirty = false,
  onEdit,
  onSave,
  onDelete,
}: {
  name: string;
  editing: boolean;
  dirty?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="row-actions">
      {editing ? (
        <button className={`row-icon save ${dirty ? 'dirty' : ''}`} onClick={onSave} title={dirty ? 'Save changes' : 'Done'} aria-label={`Save ${name}`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <button className="row-icon edit" onClick={onEdit} title="Edit" aria-label={`Edit ${name}`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M11.3 1.7a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L5.6 13.4 2 14l.6-3.6 8.7-8.7Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M9.8 3.2l3 3" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      )}
      <button className="row-icon delete" onClick={onDelete} title="Delete" aria-label={`Delete ${name}`}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  );
}
