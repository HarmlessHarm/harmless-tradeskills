import { describe, expect, it } from 'vitest';
import { fetchTooltip, parseItemTooltip, parseSpellTooltip, parseWowheadRef, tooltipText } from './adapter';

/*
 * These fixtures follow the shape of Wowhead tooltip responses but were written by hand, because the
 * endpoint is not reachable from the build environment. Replace them with captured real responses
 * (e.g. save `/wh/item/4307` from the browser) when parsing is verified against Forever data.
 */
const GLOVES = {
  name: 'Heavy Linen Gloves',
  quality: 2,
  icon: 'inv_gauntlets_18',
  tooltip:
    '<table><tr><td><!--nstart--><b class="q2">Heavy Linen Gloves</b><!--nend--><!--ndstart--><!--ndend--><span class="q"><br>Item Level <!--ilvl-->10</span><br><!--bo-->Binds when equipped<table width="100%"><tr><td>Hands</td><th><!--scstart4:1--><span class="q1">Cloth</span><!--scend--></th></tr></table><span><!--amr-->9 Armor</span><br><!--rlvl-->Requires Level 5<br></td></tr></table><table><tr><td><div class="whtt-sellprice">Sell Price: <span class="moneycopper">22</span></div></td></tr></table>',
};

const WAND = {
  name: 'Greater Magic Wand',
  quality: 2,
  tooltip:
    '<table><tr><td><b class="q2">Greater Magic Wand</b><br>Item Level 13<br><table width="100%"><tr><td>Ranged</td><th>Wand</th></tr></table><table width="100%"><tr><td>12 - 23 Arcane Damage</td><th>Speed 1.50</th></tr></table>(11.7 damage per second)<br></td></tr></table><table><tr><td><div class="whtt-sellprice">Sell Price: <span class="moneysilver">11</span> <span class="moneycopper">4</span></div></td></tr></table>',
};

const GLOVES_SPELL = {
  name: 'Heavy Linen Gloves',
  icon: 'inv_gauntlets_18',
  tooltip:
    '<table><tr><td><table width="100%"><tr><td><b>Heavy Linen Gloves</b></td></tr></table><table width="100%"><tr><td>5 sec cast</td></tr></table><div class="whtt-reagents">Reagents: <a href="/forever/item=2996/bolt-of-linen-cloth">Bolt of Linen Cloth</a> (2), <a href="/forever/item=2320/coarse-thread">Coarse Thread</a></div></td></tr></table><table><tr><td><span class="q2"><a href="/forever/item=4307/heavy-linen-gloves">Heavy Linen Gloves</a></span> (2)</td></tr></table>',
};

const OIL_SPELL = {
  name: 'Minor Wizard Oil',
  tooltip:
    '<table><tr><td><b>Minor Wizard Oil</b><br>5 sec cast<br>Tools: <a href="/forever/item=6218">Runed Copper Rod</a><br>Reagents: <a href="/forever/item=10940">Strange Dust</a>, <a href="/forever/item=17034">Maple Seed</a>, <a href="/forever/item=3371">Empty Vial</a><br></td></tr></table><table><tr><td><a href="/forever/item=20744">Minor Wizard Oil</a></td></tr></table>',
};

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

describe('item tooltips', () => {
  it('parses an armor item', () => {
    expect(parseItemTooltip(GLOVES)).toEqual({
      name: 'Heavy Linen Gloves',
      quality: 2,
      itemLevel: 10,
      itemClass: 'armor',
      subclass: 'Cloth',
      vendorSell: 22,
      icon: 'inv_gauntlets_18',
    });
  });
  it('recognises a weapon without subclass markers and reads silver', () => {
    const r = parseItemTooltip(WAND);
    expect(r.itemClass).toBe('weapon');
    expect(r.subclass).toBe('Wand');
    expect(r.itemLevel).toBe(13);
    expect(r.vendorSell).toBe(1104);
  });
  it('handles items with no sell price', () => {
    expect(parseItemTooltip({ name: 'Quest thing', tooltip: '<b class="q1">Quest thing</b><br>Quest Item' }).vendorSell).toBeNull();
  });
  it('flattens tooltip html to text', () => {
    expect(tooltipText(GLOVES.tooltip)).toContain('Item Level 10');
  });
});

describe('spell tooltips', () => {
  it('parses reagents with quantities, cast time and created item', () => {
    const r = parseSpellTooltip(GLOVES_SPELL);
    expect(r.fields.castTimeMs).toBe(5000);
    expect(r.fields.inputs).toEqual([
      { itemId: 2996, qty: 2 },
      { itemId: 2320, qty: 1 },
    ]);
    expect(r.fields.tools).toEqual([]);
    // "(2)" after a green created item is not a quantity.
    expect(r.fields.outputs).toEqual([{ itemId: 4307, chance: 1, minQty: 1, maxQty: 1 }]);
    expect(r.referencedItems.sort()).toEqual([2320, 2996, 4307]);
    expect(r.warnings).toEqual([]);
  });
  it('separates tools from reagents', () => {
    const r = parseSpellTooltip(OIL_SPELL);
    expect(r.fields.tools).toEqual([6218]);
    expect(r.fields.inputs.map((i) => i.itemId)).toEqual([10940, 17034, 3371]);
    expect(r.fields.outputs[0].itemId).toBe(20744);
  });
  it('warns when no created item is found', () => {
    const r = parseSpellTooltip({ name: 'Disenchant', tooltip: '<b>Disenchant</b><br>3 sec cast<br>Turns an item into dust.' });
    expect(r.fields.castTimeMs).toBe(3000);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('fetchTooltip', () => {
  it('goes through the same-origin proxy path', async () => {
    let url = '';
    const fake = async (u: string) => {
      url = u;
      return new Response(JSON.stringify(GLOVES));
    };
    await fetchTooltip({ type: 'item', id: 4307 }, fake);
    expect(url).toBe('/wh/item/4307');
  });
  it('turns bad responses into readable errors', async () => {
    await expect(fetchTooltip({ type: 'item', id: 1 }, async () => new Response('x', { status: 500 }))).rejects.toThrow(/HTTP 500/);
    await expect(fetchTooltip({ type: 'item', id: 1 }, async () => new Response('{"error":"not found"}'))).rejects.toThrow(/no item 1/);
  });
});
