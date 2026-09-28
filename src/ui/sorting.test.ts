import { describe, expect, it } from 'vitest';
import { compareValues, sortRows } from './sorting';

describe('sorting', () => {
  it('sorts numbers and text, empty values last in both directions', () => {
    const vals = [5, null, 12, 1];
    expect([...vals].sort((a, b) => compareValues(a, b, 'asc'))).toEqual([1, 5, 12, null]);
    expect([...vals].sort((a, b) => compareValues(a, b, 'desc'))).toEqual([12, 5, 1, null]);
    expect(['b', '', 'A', 'c'].sort((a, b) => compareValues(a, b, 'asc'))).toEqual(['A', 'b', 'c', '']);
  });

  it('breaks ties by name', () => {
    const rows = [
      { name: 'Zeta', lvl: 10 },
      { name: 'Alpha', lvl: 10 },
      { name: 'Mid', lvl: 5 },
    ];
    const sorted = sortRows(rows, { key: 'lvl', dir: 'desc' }, (r) => r.lvl, (r) => r.name);
    expect(sorted.map((r) => r.name)).toEqual(['Alpha', 'Zeta', 'Mid']);
  });
});
