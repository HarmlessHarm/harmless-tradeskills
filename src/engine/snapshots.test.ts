import { describe, expect, it } from 'vitest';
import { currentAhPrices, manualSnapshot, marketValue, normalizeLevels, parseLevels, type PriceSnapshot, priceStats, summarize, trimLevels, weightedMedian } from './snapshots';

/** Linen Cloth as seen on the AH: a deep book, cheap end first, a few silly listings at the top. */
const linen = [
  { price: 56, qty: 100 },
  { price: 58, qty: 450 },
  { price: 61, qty: 900 },
  { price: 65, qty: 800 },
  { price: 80, qty: 500 },
  { price: 300, qty: 200 },
  { price: 900, qty: 50 },
];
const linenTotal = 3000;

const snap = (observedAt: number, levels: { price: number; qty: number }[], totalQty: number | null, truncated = true): PriceSnapshot => ({
  uid: `s${observedAt}`,
  itemId: 2589,
  observedAt,
  ahType: 'faction',
  source: 'manual',
  totalQty,
  levels,
  truncated,
});

describe('order book rows', () => {
  it('sorts, merges equal prices and drops empty rows', () => {
    expect(
      normalizeLevels([
        { price: 58, qty: 10 },
        { price: 56, qty: 5 },
        { price: 58, qty: 2 },
        { price: 60, qty: 0 },
        { price: -1, qty: 3 },
      ]),
    ).toEqual([
      { price: 56, qty: 5 },
      { price: 58, qty: 12 },
    ]);
  });
});

describe('market value', () => {
  it('averages the cheapest 15% and continues to 30% while prices stay close', () => {
    // 15% of 3000 = 450, 30% = 900: 100 @ 56, 450 @ 58, then 350 of the 61c row (5% step).
    const r = marketValue(linen, linenTotal, false)!;
    expect(r.confidence).toBe('solid');
    expect(r.value).toBe(Math.round((100 * 56 + 450 * 58 + 350 * 61) / 900));
  });

  it('ignores overpriced listings entirely', () => {
    const withJunk = [...linen, { price: 1_000_000, qty: 5 }];
    expect(marketValue(withJunk, linenTotal + 5, false)!.value).toBe(marketValue(linen, linenTotal, false)!.value);
  });

  it('stops at a price jump once the minimum share is in', () => {
    // 15% of 1000 = 150 units, reached inside the 52c row, which is then taken up to 30% (300).
    // The 80c row is a 54% jump, so it stops there.
    const book = [
      { price: 50, qty: 100 },
      { price: 52, qty: 100 },
      { price: 80, qty: 800 },
    ];
    expect(marketValue(book, 1000, false)!.value).toBe(Math.round((100 * 50 + 100 * 52) / 200));
  });

  it('always includes the minimum share, even across a jump', () => {
    // 15% of 1000 = 150 units, but the cheapest row only has 10: the 50c row is needed despite the
    // jump, and then filled up to 30% (300 units).
    const book = [
      { price: 10, qty: 10 },
      { price: 50, qty: 990 },
    ];
    expect(marketValue(book, 1000, false)!.value).toBe(Math.round((10 * 10 + 290 * 50) / 300));
  });

  it('is partial when typed-in rows cover too little of the book', () => {
    // 100 units typed in out of 3000: less than the 15% needed.
    const r = marketValue([{ price: 56, qty: 100 }], linenTotal, true)!;
    expect(r).toEqual({ value: 56, confidence: 'partial' });
  });

  it('is partial when the total is unknown and the rows are not the whole book', () => {
    expect(marketValue(linen.slice(0, 2), null, true)!.confidence).toBe('partial');
  });

  it('treats a complete book without a total as its own total', () => {
    expect(marketValue(linen, null, false)).toEqual(marketValue(linen, linenTotal, false));
  });

  it('has no value without rows', () => {
    expect(marketValue([], 100, true)).toBeNull();
  });
});

describe('snapshot summary', () => {
  it('stores the cheapest row and the market value', () => {
    expect(summarize({ levels: linen, totalQty: linenTotal, truncated: false })).toEqual({
      minPrice: 56,
      minQty: 100,
      marketValue: marketValue(linen, linenTotal, false)!.value,
      confidence: 'solid',
    });
    expect(summarize({ levels: [], totalQty: 10, truncated: true })).toEqual({ minPrice: null, minQty: null, marketValue: null, confidence: null });
  });
});

describe('trimming a full book', () => {
  it('drops overpriced rows past the cheapest half', () => {
    const { levels, truncated } = trimLevels(linen);
    expect(truncated).toBe(true);
    // Half the units is 1500 (reached within the 65c row); 80c is under 2x the ~59c market value.
    expect(levels.map((l) => l.price)).toEqual([56, 58, 61, 65, 80]);
  });

  it('keeps a book with nothing to drop as is', () => {
    const book = linen.slice(0, 3);
    expect(trimLevels(book)).toEqual({ levels: book, truncated: false });
  });
});

describe('price stats', () => {
  it('reports last, min, typical and n', () => {
    const snaps = [
      snap(3, [{ price: 42, qty: 20 }], 400), // partial: 20 of 400
      snap(1, linen, linenTotal, false),
      snap(2, [{ price: 60, qty: 900 }], linenTotal), // solid: 900 of 3000
    ];
    const s = priceStats(snaps);
    expect(s.n).toBe(3);
    expect(s.nSolid).toBe(2);
    expect(s.last).toEqual({ price: 42, qty: 20, observedAt: 3 });
    expect(s.min).toBe(42);
    // Values 42 (weight .5), ~58.6 (1) and 60 (1): half of 2.5 is reached at the middle one.
    expect(s.typical).toBe(marketValue(linen, linenTotal, false)!.value);
  });

  it('has empty stats without snapshots', () => {
    expect(priceStats([])).toEqual({ n: 0, nSolid: 0, last: null, min: null, typical: null });
  });
});

describe('weighted median', () => {
  it('counts weights', () => {
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 2, weight: 1 }, { value: 3, weight: 1 }])).toBe(2);
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 9, weight: 1 }])).toBe(5);
    expect(weightedMedian([{ value: 1, weight: 0.5 }, { value: 9, weight: 1 }])).toBe(9);
    expect(weightedMedian([])).toBeNull();
  });
});

describe('typed-in rows', () => {
  it('reads quantity x price rows in money notation', () => {
    expect(parseLevels('100x56c 450x58c').levels).toEqual([
      { price: 56, qty: 100 },
      { price: 58, qty: 450 },
    ]);
    expect(parseLevels('20 x 1g 5s, 3@2g\n7*150').levels).toEqual([
      { price: 10_500, qty: 20 },
      { price: 20_000, qty: 3 },
      { price: 150, qty: 7 },
    ]);
    // A bare number is copper, also when another row follows.
    expect(parseLevels('100x56 450x58').levels).toEqual([
      { price: 56, qty: 100 },
      { price: 58, qty: 450 },
    ]);
    expect(parseLevels('  ')).toEqual({ levels: [], errors: [] });
  });

  it('reports what it cannot read instead of guessing', () => {
    const r = parseLevels('56c 450x58c lots');
    expect(r.levels).toEqual([{ price: 58, qty: 450 }]);
    expect(r.errors).toEqual(['Not a row: "56c"', 'Not a row: "lots"']);
  });
});

describe('manual snapshot', () => {
  const base = { itemId: 2589, ahType: 'faction' as const, observedAt: 1, uid: 'u' };

  it('needs only the lowest price; its quantity defaults to 1', () => {
    const s = manualSnapshot({ ...base, lowest: 56, lowestQty: null, totalQty: 3000, more: [] });
    expect(s).toMatchObject({ source: 'manual', levels: [{ price: 56, qty: 1 }], totalQty: 3000, truncated: true });
    expect(summarize(s)).toMatchObject({ minPrice: 56, marketValue: 56, confidence: 'partial' });
  });

  it('adds typed rows and is solid once they cover enough of the total', () => {
    const s = manualSnapshot({ ...base, lowest: 56, lowestQty: 100, totalQty: 3000, more: [{ price: 58, qty: 450 }] });
    expect(s.levels).toEqual([
      { price: 56, qty: 100 },
      { price: 58, qty: 450 },
    ]);
    expect(summarize(s).confidence).toBe('solid');
  });

  it('is complete when the rows hold every unit, and never claims fewer units than it lists', () => {
    expect(manualSnapshot({ ...base, lowest: 42000, lowestQty: 1, totalQty: 1, more: [] }).truncated).toBe(false);
    expect(manualSnapshot({ ...base, lowest: 56, lowestQty: 100, totalQty: 50, more: [] }).totalQty).toBe(100);
    expect(manualSnapshot({ ...base, lowest: 56, lowestQty: 1, totalQty: null, more: [] }).truncated).toBe(true);
  });

  it('gets a unique manual uid', () => {
    const { uid: _, ...noUid } = base;
    const a = manualSnapshot({ ...noUid, lowest: 1, lowestQty: 1, totalQty: null, more: [] });
    const b = manualSnapshot({ ...noUid, lowest: 1, lowestQty: 1, totalQty: null, more: [] });
    expect(a.uid).toMatch(/^manual-/);
    expect(a.uid).not.toBe(b.uid);
  });
});

describe('current AH price for workflows', () => {
  const snaps = [
    snap(1, [{ price: 60, qty: 900 }], 3000),
    snap(2, [{ price: 58, qty: 900 }], 3000),
    snap(3, [{ price: 42, qty: 20 }], 3000),
    { ...snap(4, [{ price: 70, qty: 5 }], null), ahType: 'neutral' as const },
  ];

  it("'latest' takes the newest snapshot per item and AH", () => {
    const byKey = new Map(currentAhPrices(snaps, 'latest').map((p) => [`${p.itemId}:${p.ahType}`, p]));
    expect(byKey.get('2589:faction')).toEqual({ itemId: 2589, ahType: 'faction', price: 42, observedAt: 3, n: 3 });
    expect(byKey.get('2589:neutral')).toMatchObject({ price: 70, n: 1 });
  });

  it("'typical' takes the typical price, so one odd low does not move it", () => {
    const faction = currentAhPrices(snaps, 'typical').find((p) => p.ahType === 'faction')!;
    expect(faction.price).toBe(58);
    expect(faction.observedAt).toBe(3);
  });

  it('has nothing for an item without snapshots', () => {
    expect(currentAhPrices([], 'latest')).toEqual([]);
  });
});
