import { describe, expect, it } from 'vitest';
import { selectRange } from './Selection';

describe('selectRange (shift-click)', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];
  it('selects everything between anchor and target, either direction', () => {
    expect([...selectRange(new Set(), keys, 'b', 'd', true)].sort()).toEqual(['b', 'c', 'd']);
    expect([...selectRange(new Set(), keys, 'd', 'b', true)].sort()).toEqual(['b', 'c', 'd']);
  });
  it('clears a range, keeping the rest', () => {
    expect([...selectRange(new Set(keys), keys, 'b', 'd', false)].sort()).toEqual(['a', 'e']);
  });
  it('acts on the target alone without a visible anchor', () => {
    expect([...selectRange(new Set(['a']), keys, null, 'c', true)].sort()).toEqual(['a', 'c']);
    expect([...selectRange(new Set(), keys, 'gone', 'c', true)]).toEqual(['c']);
  });
});
