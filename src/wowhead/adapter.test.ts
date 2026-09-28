import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractProfessions, extractVendorPrices, withoutProfessionSpells, extractWowheadRefs, fetchTooltip, parseItemTooltip, parseSpellTooltip, parseWowheadRef, tooltipText, type TooltipResponse } from './adapter';

/** Real Forever tooltip responses, saved byte for byte. See fixtures/. */
const fixture = (name: string): TooltipResponse =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8'));

describe('parseWowheadRef', () => {
  it('reads pasted URLs', () => {
    expect(parseWowheadRef('https://www.wowhead.com/forever/spell=3840/heavy-linen-gloves', 'item')).toEqual({ type: 'spell', id: 3840 });
    expect(parseWowheadRef('https://www.wowhead.com/forever/item=4307', 'spell')).toEqual({ type: 'item', id: 4307 });
    expect(parseWowheadRef('https://nether.wowhead.com/forever/tooltip/item/4307', 'spell')).toEqual({ type: 'item', id: 4307 });
  });
  it('uses the fallback type for bare IDs', () => {
    expect(parseWowheadRef(' 2589 ', 'item')).toEqual({ type: 'item', id: 2589 });
    expect(parseWowheadRef('nonsense', 'item')).toBeNull();
  });
});

describe('extractWowheadRefs', () => {
  it('reads item and spell links from a copied listview selection', () => {
    // Shape of a browser clipboard copy of two recipe rows: icon link, name link, reagent links, other links.
    const html = `<table><tbody>
      <tr><td><a href="https://www.wowhead.com/forever/item=4307/heavy-linen-gloves"><ins></ins></a></td>
      <td><a href="https://www.wowhead.com/forever/spell=3840/heavy-linen-gloves">Heavy Linen Gloves</a></td>
      <td><a href="/forever/item=2996/bolt-of-linen-cloth">Bolt of Linen Cloth</a> 2 <a href="/forever/item=2320">Coarse&nbsp;Thread</a></td>
      <td><a href="/forever/skill=197">Tailoring</a> <a href="/forever/npc=1103">Eldrin</a></td></tr>
      <tr><td><a href="https://www.wowhead.com/forever/item=4307/heavy-linen-gloves">Heavy Linen Gloves</a></td></tr>
    </tbody></table>`;
    expect(extractWowheadRefs(html)).toEqual([
      { type: 'item', id: 4307, name: 'Heavy Linen Gloves' },
      { type: 'spell', id: 3840, name: 'Heavy Linen Gloves' },
      { type: 'item', id: 2996, name: 'Bolt of Linen Cloth' },
      { type: 'item', id: 2320, name: 'Coarse Thread' },
    ]);
  });
  it('falls back to URLs in plain text', () => {
    const text = 'https://www.wowhead.com/forever/spell=25124/minor-wizard-oil\nhttps://www.wowhead.com/forever/item=10940';
    expect(extractWowheadRefs('', text)).toEqual([
      { type: 'spell', id: 25124, name: null },
      { type: 'item', id: 10940, name: null },
    ]);
  });
});

describe('withoutProfessionSpells', () => {
  it('drops spell links named after a profession, keeping recipes and items', () => {
    const refs = [
      { type: 'spell' as const, id: 2259, name: 'Alchemy' },
      { type: 'spell' as const, id: 2330, name: 'Minor Healing Potion' },
      { type: 'item' as const, id: 118, name: 'Minor Healing Potion' },
      { type: 'spell' as const, id: 99_999, name: 'Jewelcrafting' },
      { type: 'spell' as const, id: 12_345, name: null },
    ];
    expect(withoutProfessionSpells(refs, ['Jewelcrafting']).map((r) => r.id)).toEqual([2330, 118, 12_345]);
  });
});

describe('extractVendorPrices', () => {
  const row = (id: number, name: string, cost: string) =>
    `<tr><td><a href="/forever/item=${id}"><ins></ins></a></td><td><span>Updated</span></td>
     <td><a href="https://www.wowhead.com/forever/item=${id}/x" class="q1">${name}</a></td><td>20</td>
     <td><a href="/forever/items?filter=vendors">Vendors</a></td><td><a href="/forever/items=7.11">Trade Good</a></td><td>${cost}</td></tr>`;
  const money = (g: number, s: number, c: number) =>
    [g && `<span class="moneygold">${g}</span>`, s && `<span class="moneysilver">${s}</span>`, c && `<span class="moneycopper">${c}</span>`].filter(Boolean).join(' ');

  it('reads each row\'s item and cost in copper', () => {
    const html = `<table><tbody>${row(2320, 'Coarse Thread', money(0, 0, 10))}${row(2321, 'Fine&nbsp;Thread', money(0, 1, 5))}${row(
      14341,
      'Rune Thread',
      money(1, 0, 5),
    )}</tbody></table>`;
    expect(extractVendorPrices(html)).toEqual([
      { itemId: 2320, name: 'Coarse Thread', price: 10, stack: 1, stackPrice: 10, type: 'Trade Good', classId: 7 },
      { itemId: 2321, name: 'Fine Thread', price: 105, stack: 1, stackPrice: 105, type: 'Trade Good', classId: 7 },
      { itemId: 14341, name: 'Rune Thread', price: 10005, stack: 1, stackPrice: 10005, type: 'Trade Good', classId: 7 },
    ]);
  });
  it('divides a stack\'s cost by the count on its icon, not by numbers in other cells', () => {
    // Icon with a stack count (drawn twice for the outline), then a changes cell with a "(1)".
    const html = `<table><tr><td><div class="iconsmall"><a href="/forever/item=3371"></a><span class="glow q1"><div>5</div><div>5</div></span></div></td>
      <td>Updated<br>Requirements changed (1)</td><td><a href="/forever/item=3371/empty-vial">Empty Vial</a></td>
      <td><span class="moneysilver">1</span></td></tr></table>`;
    expect(extractVendorPrices(html)).toEqual([{ itemId: 3371, name: 'Empty Vial', price: 20, stack: 5, stackPrice: 100, type: null, classId: null }]);
  });
  it('works without row tags and skips rows without a money cost', () => {
    const html = `<a href="/forever/item=1">A</a> <span class="moneysilver">2</span><a href="/forever/item=2">B</a> 3 <a href="/forever/item=3">C</a><span class="moneycopper">7</span>`;
    expect(extractVendorPrices(html)).toEqual([
      { itemId: 1, name: 'A', price: 200, stack: 1, stackPrice: 200, type: null, classId: null },
      { itemId: 3, name: 'C', price: 7, stack: 1, stackPrice: 7, type: null, classId: null },
    ]);
  });
});

describe('extractProfessions', () => {
  it('reads profession names from skill links and ignores bare skill levels', () => {
    const html = '<a href="/forever/skill=197/tailoring">Tailoring</a> <a href="/forever/skill=197">75</a> <a href="/forever/skill=197">Tailoring</a>';
    expect(extractProfessions(html)).toEqual(['Tailoring']);
    expect(extractProfessions('<a href="/forever/item=1">x</a>')).toEqual([]);
  });
});

describe('item tooltips (real responses)', () => {
  it('parses an armor item', () => {
    expect(parseItemTooltip(fixture('item-4307'))).toEqual({
      name: 'Heavy Linen Gloves',
      quality: 2,
      itemLevel: 10,
      itemClass: 'armor',
      subclass: 'Cloth',
      vendorSell: 29,
      icon: 'inv_gauntlets_05',
    });
  });
  it('parses a weapon with a silver and copper sell price', () => {
    expect(parseItemTooltip(fixture('item-11288'))).toEqual({
      name: 'Greater Magic Wand',
      quality: 2,
      itemLevel: 23,
      itemClass: 'weapon',
      subclass: 'Wand',
      vendorSell: 1535,
      icon: 'inv_staff_07',
    });
  });
  it('parses reagents and tools as "other"', () => {
    expect(parseItemTooltip(fixture('item-2589'))).toMatchObject({ name: 'Linen Cloth', quality: 1, itemLevel: 5, itemClass: 'other', vendorSell: 13 });
    expect(parseItemTooltip(fixture('item-10940'))).toMatchObject({ name: 'Strange Dust', itemLevel: 10, itemClass: 'other', vendorSell: 1 });
    expect(parseItemTooltip(fixture('item-6218'))).toMatchObject({ name: 'Runed Copper Rod', itemLevel: 5, itemClass: 'other', vendorSell: 24 });
  });
  it('handles items with no sell price', () => {
    expect(parseItemTooltip({ name: 'Quest thing', tooltip: '<b class="q1">Quest thing</b><br>Quest Item' }).vendorSell).toBeNull();
  });
  it('flattens tooltip html to text', () => {
    expect(tooltipText(fixture('item-4307').tooltip)).toContain('Item Level 10');
  });
});

describe('spell tooltips (real responses)', () => {
  const recipe = (name: string) => parseSpellTooltip(fixture(name));

  it('Heavy Linen Gloves: reagents with quantities, fractional cast time, created item', () => {
    const r = recipe('spell-3840');
    expect(r.fields.name).toBe('Heavy Linen Gloves');
    expect(r.fields.castTimeMs).toBe(5125);
    expect(r.fields.inputs).toEqual([
      { itemId: 2996, qty: 2 },
      { itemId: 2320, qty: 1 },
    ]);
    // "(2)" after the created item is not treated as a quantity.
    expect(r.fields.outputs).toEqual([{ itemId: 4307, chance: 1, minQty: 1, maxQty: 1 }]);
    expect(r.fields.tools).toEqual([]);
    expect(r.referencedItems).toEqual([2996, 2320, 4307]);
    expect(r.warnings).toEqual([]);
  });

  it('Bolt of Linen Cloth: single reagent', () => {
    const r = recipe('spell-2963');
    expect(r.fields.castTimeMs).toBe(3000);
    expect(r.fields.inputs).toEqual([{ itemId: 2589, qty: 2 }]);
    expect(r.fields.outputs[0].itemId).toBe(2996);
  });

  it('Minor Wizard Oil: skips tools and the "Creates" line', () => {
    const r = recipe('spell-25124');
    expect(r.fields.castTimeMs).toBe(5000);
    expect(r.fields.inputs).toEqual([
      { itemId: 10940, qty: 1 },
      { itemId: 17034, qty: 1 },
      { itemId: 3371, qty: 1 },
    ]);
    expect(r.fields.tools).toEqual([]);
    expect(r.fields.outputs[0].itemId).toBe(20744);
    expect(r.referencedItems).not.toContain(6218);
    expect(r.warnings).toEqual([]);
  });

  it('Greater Magic Wand: quantity on the last reagent', () => {
    const r = recipe('spell-14807');
    expect(r.fields.castTimeMs).toBe(10000);
    expect(r.fields.inputs).toEqual([
      { itemId: 4470, qty: 1 },
      { itemId: 10938, qty: 2 },
    ]);
    expect(r.fields.outputs[0].itemId).toBe(11288);
  });

  it('Disenchant: no reagents or created item, with warnings', () => {
    const r = recipe('spell-13262');
    expect(r.fields.castTimeMs).toBe(3000);
    expect(r.fields.inputs).toEqual([]);
    expect(r.fields.outputs).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });
});

describe('fetchTooltip', () => {
  it('goes through the same-origin proxy path', async () => {
    let url = '';
    const fake = async (u: string) => {
      url = u;
      return new Response(JSON.stringify(fixture('item-4307')));
    };
    await fetchTooltip({ type: 'item', id: 4307 }, fake);
    expect(url).toBe('/wh/item/4307');
  });
  it('turns bad responses into readable errors', async () => {
    await expect(fetchTooltip({ type: 'item', id: 1 }, async () => new Response('x', { status: 500 }))).rejects.toThrow(/HTTP 500/);
    await expect(fetchTooltip({ type: 'item', id: 1 }, async () => new Response('{"error":"not found"}'))).rejects.toThrow(/no item 1/);
  });
});
