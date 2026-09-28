import { useState } from 'react';

export type SortDir = 'asc' | 'desc';
export type SortValue = string | number | null | undefined;

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/** Click a column to sort by it; click again to reverse. */
export function useSort<K extends string>(initial: K, initialDir: SortDir = 'asc') {
  const [state, setState] = useState<SortState<K>>({ key: initial, dir: initialDir });
  return {
    ...state,
    toggle: (key: K) => setState((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })),
  };
}

/** Compare two cell values. Empty values always sort last, whichever the direction. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? c : -c;
}

/** Sort rows by the active column, then by name so ties stay stable and readable. */
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, value: (row: T, key: K) => SortValue, name: (row: T) => string): T[] {
  return [...rows].sort((x, y) => compareValues(value(x, sort.key), value(y, sort.key), sort.dir) || name(x).localeCompare(name(y)));
}

export function SortHeader<K extends string>({
  label,
  k,
  sort,
  className = '',
}: {
  label: string;
  k: K;
  sort: SortState<K> & { toggle: (key: K) => void };
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className={`sort-btn ${active ? 'on' : ''}`} onClick={() => sort.toggle(k)}>
        {label}
        <span className="sort-arrow" aria-hidden="true">
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}
