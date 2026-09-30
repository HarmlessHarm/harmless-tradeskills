/**
 * The only module that knows about Wowhead (NFR-3). It maps tooltip responses to our own
 * item and recipe shapes, so a Wowhead change is a one-file fix.
 *
 * Endpoint (unofficial, used by Wowhead's own tooltip script, DEC-4):
 *   https://nether.wowhead.com/forever/tooltip/{item|spell}/{id}
 * reached through our same-origin proxy path /wh/{item|spell}/{id} (vite.config.ts, vercel.json).
 *
 * Be polite (NFR-4): callers fetch on demand only and cache the result in the database.
 */
import type { ItemClass, ItemFields, Qty, Quality, RecipeFields, RecipeSource, SkillRange } from '../engine/types';
import { PROFESSIONS } from '../professions';

export type WowheadType = 'item' | 'spell';

export interface WowheadRef {
  type: WowheadType;
  id: number;
}

/** Accepts "https://www.wowhead.com/forever/spell=3840/heavy-linen-gloves", "item=4307" or a bare ID. */
export function parseWowheadRef(input: string, fallbackType: WowheadType): WowheadRef | null {
  const text = input.trim();
  const m = /\b(item|spell)=(\d+)/i.exec(text);
  if (m) return { type: m[1].toLowerCase() as WowheadType, id: Number(m[2]) };
  const path = /\/(item|spell)\/(\d+)/i.exec(text);
  if (path) return { type: path[1].toLowerCase() as WowheadType, id: Number(path[2]) };
  if (/^\d+$/.test(text)) return { type: fallbackType, id: Number(text) };
  return null;
}

export interface PastedRef extends WowheadRef {
  /** Link text, when the paste had one. */
  name: string | null;
}

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * Find every Wowhead item and spell link in something copied from a Wowhead page, such as rows
 * selected in a listview table. Browsers put the selection on the clipboard as HTML, which keeps
 * the links; plain text only keeps URLs that were written out. Deduplicated, in page order.
 */
export function extractWowheadRefs(html: string, text = ''): PastedRef[] {
  const found = new Map<string, PastedRef>();
  const add = (type: WowheadType, id: number, name: string | null) => {
    const key = `${type}:${id}`;
    const existing = found.get(key);
    if (!existing) found.set(key, { type, id, name: name || null });
    else if (!existing.name && name) existing.name = name;
  };
  const anchors = /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = anchors.exec(html); m; m = anchors.exec(html)) {
    const ref = /[/?&](item|spell)=(\d+)/i.exec(m[1]);
    if (!ref) continue;
    const name = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    add(ref[1].toLowerCase() as WowheadType, Number(ref[2]), name);
  }
  const urls = /wowhead\.com\/\S*?\b(item|spell)=(\d+)/gi;
  for (let m = urls.exec(text); m; m = urls.exec(text)) add(m[1].toLowerCase() as WowheadType, Number(m[2]), null);
  return [...found.values()];
}

/**
 * Drop spell links to a profession itself, such as "Alchemy" in a copied recipe table: the
 * profession is a spell on Wowhead, but not a recipe. Matched by link text against known
 * professions and any extra names (such as the professions found in the same paste).
 */
export function withoutProfessionSpells(refs: PastedRef[], extraNames: string[] = []): PastedRef[] {
  const names = new Set([...PROFESSIONS, ...extraNames].map((n) => n.toLowerCase()));
  return refs.filter((r) => !(r.type === 'spell' && r.name && names.has(r.name.toLowerCase())));
}

/**
 * A link to a profession: /skill=197, or /spells=11.171 (the profession's spell list, which is how
 * a recipe table's skill column links it). The link text is the profession's name.
 */
const PROFESSION_LINK = /<a\b[^>]*\bhref\s*=\s*["'][^"']*[/?&](?:skill=\d+|spells=11\.\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Profession names linked in a pasted selection. Used to suggest a profession for pasted recipes;
 * empty when the page has none.
 */
export function extractProfessions(html: string): string[] {
  const names = new Set<string>();
  const anchors = new RegExp(PROFESSION_LINK.source, 'gi');
  for (let m = anchors.exec(html); m; m = anchors.exec(html)) {
    const name = decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (name && !/^\d+$/.test(name)) names.add(name);
  }
  return [...names];
}

export interface PastedRecipeRow {
  spellId: number;
  /** Profession named in the skill column, when the row has one. */
  profession: string | null;
  /** The skill in "Alchemy (50)". */
  requiredSkill: number | null;
  /** The Source column, such as "Quest, Trainer". Empty when the row has none. */
  learnedFrom: RecipeSource[];
  skillRange: SkillRange | null;
}

const SOURCE_WORDS: [RegExp, RecipeSource][] = [
  [/trainer/i, 'trainer'],
  [/vendor/i, 'vendor'],
  [/drop/i, 'drop'],
  [/quest/i, 'quest'],
];

/** "Quest, Trainer" to ['quest', 'trainer']. Words we do not know become 'other'. */
export function parseRecipeSources(text: string): RecipeSource[] {
  const found = new Set<RecipeSource>();
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    found.add(SOURCE_WORDS.find(([re]) => re.test(part))?.[1] ?? 'other');
  }
  return [...found];
}

/**
 * Skill levels from a recipe table's skill cell: spans r1 (orange), r2 (yellow), r3 (green) and
 * r4 (grey). A recipe without an orange tier has no r1. null unless yellow, green and grey are all there.
 */
function parseSkillRange(html: string): SkillRange | null {
  const tier: Record<string, number> = {};
  const re = /<span\b[^>]*\bclass\s*=\s*["'][^"']*\br([1-4])\b[^"']*["'][^>]*>\s*(\d+)\s*<\/span>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) tier[m[1]] ??= Number(m[2]);
  if (tier['2'] === undefined || tier['3'] === undefined || tier['4'] === undefined) return null;
  return { orange: tier['1'] ?? null, yellow: tier['2'], green: tier['3'], grey: tier['4'] };
}

/**
 * How each recipe is learned, from rows copied out of a profession's recipe table on Wowhead. The
 * skill cell holds the profession link with the required skill ("Alchemy (50)") and the colored
 * skill levels; the Source column is the cell just before it. Rows without a recipe link are left
 * out; a row without a skill cell is kept with empty values.
 */
export function extractRecipeRows(html: string): PastedRecipeRow[] {
  const rows = /<tr\b/i.test(html) ? html.split(/<tr\b/i) : [html];
  const found = new Map<number, PastedRecipeRow>();
  for (const row of rows) {
    const spell = /<a\b[^>]*\bhref\s*=\s*["'][^"']*[/?&]spell=(\d+)[^"']*["']/i.exec(row);
    if (!spell) continue;
    const spellId = Number(spell[1]);
    if (found.has(spellId)) continue;
    const cells = row.split(/<td\b/i).slice(1);
    const skillAt = cells.findIndex((c) => new RegExp(PROFESSION_LINK.source, 'i').test(c));
    const skillCell = skillAt >= 0 ? cells[skillAt] : '';
    const prof = new RegExp(PROFESSION_LINK.source, 'i').exec(skillCell);
    const required = prof ? /^\s*(?:&nbsp;)?\s*\((\d+)\)/.exec(skillCell.slice(prof.index + prof[0].length)) : null;
    const sourceText = skillAt > 0 ? tooltipText(cells[skillAt - 1].replace(/^[^>]*>/, '')).replace(/\n/g, ' ') : '';
    found.set(spellId, {
      spellId,
      profession: prof ? decodeEntities(prof[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() || null : null,
      requiredSkill: required ? Number(required[1]) : null,
      learnedFrom: /^[a-z ,]+$/i.test(sourceText) ? parseRecipeSources(sourceText) : [],
      skillRange: parseSkillRange(skillCell),
    });
  }
  return [...found.values()];
}

export interface PastedVendorPrice {
  itemId: number;
  name: string | null;
  /** Price in copper for one item: the listed cost divided by the stack size. */
  price: number;
  /** How many the vendor sells for the listed cost; 1 unless the row shows a stack count. */
  stack: number;
  /** The listed cost in copper, for the whole stack. */
  stackPrice: number;
  /** The Type column, such as "Trade Good" or "Tailoring Pattern", when the row has one. */
  type: string | null;
  /** Wowhead's item class ID from the Type column's link (2 weapon, 4 armor, 7 trade goods, ...). */
  classId: number | null;
}

/** The first link to an item class list (the Type column, /items=7.5) in a chunk of a row. */
function itemType(html: string): { type: string | null; classId: number | null } {
  const m = /<a\b[^>]*\bhref\s*=\s*["'][^"']*[/?&]items=(\d+)(?:\.\d+)*[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(html);
  if (!m) return { type: null, classId: null };
  const type = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  return { type: type || null, classId: Number(m[1]) };
}

/**
 * Stack count on an item icon, such as the "5" on a vendor's stack of vials. Wowhead draws it as
 * text inside the icon, so it is the only number in the table cell that holds the icon link.
 */
function stackCount(row: string, linkStart: number, linkEnd: number): number {
  const cellStart = row.lastIndexOf('<td', linkStart);
  const cellEnd = row.indexOf('</td>', linkEnd);
  if (cellStart < 0 || cellEnd < 0) return 1;
  const cell = row.slice(cellStart, cellEnd).replace(/<a\b[\s\S]*?<\/a>/gi, '');
  const n = /\b(\d+)\b/.exec(tooltipText(cell.replace(/^<td[^>]*>/i, '')));
  return n && Number(n[1]) > 1 ? Number(n[1]) : 1;
}

const MONEY_SPAN = /<span\b[^>]*\bclass\s*=\s*["'][^"']*\bmoney(gold|silver|copper)\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/gi;
const MONEY_UNIT = { gold: 10_000, silver: 100, copper: 1 } as const;

/** The first run of gold/silver/copper spans in a chunk of HTML, in copper; null if there is none. */
function firstMoney(html: string): number | null {
  const re = new RegExp(MONEY_SPAN.source, 'gi');
  let total: number | null = null;
  let lastEnd = -1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    // Only spans next to each other form one amount; a later one belongs to another cell.
    if (total !== null && tooltipText(html.slice(lastEnd, m.index)) !== '') break;
    total = (total ?? 0) + Number(m[2].replace(/,/g, '')) * MONEY_UNIT[m[1].toLowerCase() as keyof typeof MONEY_UNIT];
    lastEnd = m.index + m[0].length;
  }
  return total;
}

/**
 * Items and their prices from rows copied out of a vendor's "Sells" table on Wowhead. The copied
 * HTML shows the cost as money spans (plain text drops the units, so "1 5" could be 1s 5c or
 * 1g 5c). Each item's price is the first amount after its link, up to the next item's link.
 * A stack count on the item's icon (vendors sell some items only in stacks) divides the cost, so
 * the price is always for one item. The Type column's link gives the item's class. Rows without a gold price (token or item costs) are left out.
 */
export function extractVendorPrices(html: string): PastedVendorPrice[] {
  const rows = /<tr\b/i.test(html) ? html.split(/<tr\b/i) : [html];
  const found = new Map<number, PastedVendorPrice>();
  for (const row of rows) {
    // `first*` is the item's first link (the icon, when there is one); `end` is past its last.
    const links: { id: number; name: string; start: number; firstEnd: number; end: number }[] = [];
    const anchors = /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (let m = anchors.exec(row); m; m = anchors.exec(row)) {
      const ref = /[/?&]item=(\d+)/i.exec(m[1]);
      if (!ref) continue;
      const name = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      const id = Number(ref[1]);
      const prev = links[links.length - 1];
      // The icon and the name both link the item; treat them as one.
      if (prev && prev.id === id) {
        prev.end = m.index + m[0].length;
        if (!prev.name) prev.name = name;
      } else links.push({ id, name, start: m.index, firstEnd: m.index + m[0].length, end: m.index + m[0].length });
    }
    links.forEach((l, i) => {
      const rest = row.slice(l.end, links[i + 1]?.start ?? row.length);
      const stackPrice = firstMoney(rest);
      if (stackPrice === null || found.has(l.id)) return;
      // Only an icon link separate from the name link can carry a stack count.
      const stack = l.firstEnd < l.end ? stackCount(row, l.start, l.firstEnd) : 1;
      found.set(l.id, { itemId: l.id, name: l.name || null, price: stackPrice / stack, stack, stackPrice, ...itemType(rest) });
    });
  }
  return [...found.values()];
}

export interface TooltipResponse {
  name: string;
  quality?: number;
  icon?: string;
  tooltip: string;
}

export class WowheadError extends Error {}

export type Fetcher = (url: string) => Promise<Response>;

export async function fetchTooltip(ref: WowheadRef, fetcher: Fetcher = fetch): Promise<TooltipResponse> {
  const res = await fetcher(`/wh/${ref.type}/${ref.id}`);
  if (!res.ok) throw new WowheadError(`Wowhead returned HTTP ${res.status} for ${ref.type} ${ref.id}.`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new WowheadError(`Wowhead returned something that is not JSON for ${ref.type} ${ref.id}.`);
  }
  const data = json as Partial<TooltipResponse> & { error?: string };
  if (data.error || typeof data.tooltip !== 'string' || typeof data.name !== 'string') {
    throw new WowheadError(`Wowhead has no ${ref.type} ${ref.id}${data.error ? `: ${data.error}` : ''}.`);
  }
  return data as TooltipResponse;
}

// ---------------------------------------------------------------------------
// Parsing helpers

const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '');

/** Tooltip HTML to plain text lines. */
export function tooltipText(html: string): string {
  return stripComments(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|table|div|p)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function parseSellPrice(html: string): number | null {
  const start = html.search(/Sell Price/i);
  if (start < 0) return null;
  const chunk = html.slice(start, start + 600);
  const end = chunk.search(/<\/div>/i);
  const section = end >= 0 ? chunk.slice(0, end) : chunk;
  const unit = (cls: string) => {
    const m = new RegExp(`class="money${cls}"[^>]*>\\s*([\\d,]+)`, 'i').exec(section);
    return m ? Number(m[1].replace(/,/g, '')) : 0;
  };
  const total = unit('gold') * 10000 + unit('silver') * 100 + unit('copper');
  if (total > 0) return total;
  // Fallback: plain text like "Sell Price: 1g 2s 3c" or a bare copper number.
  const text = tooltipText(section);
  const g = /(\d+)\s*g/.exec(text);
  const s = /(\d+)\s*s\b/.exec(text);
  const c = /(\d+)\s*c\b/.exec(text);
  if (g || s || c) return Number(g?.[1] ?? 0) * 10000 + Number(s?.[1] ?? 0) * 100 + Number(c?.[1] ?? 0);
  const bare = /Sell Price:?\s*(\d+)/i.exec(text);
  return bare ? Number(bare[1]) : null;
}

const WEAPON_WORDS =
  /\b(Axe|Bow|Crossbow|Dagger|Fist Weapon|Gun|Mace|Polearm|Staff|Sword|Thrown|Wand|Fishing Pole)\b/;

function parseItemClass(html: string, text: string): { itemClass: ItemClass; subclass: string | null } {
  // Wowhead marks the subclass with <!--scstart{classId}:{subclassId}-->Name<!--scend-->. Class 2 = weapon, 4 = armor.
  const sc = /<!--scstart(\d+):(\d+)-->([\s\S]*?)<!--scend-->/.exec(html);
  if (sc) {
    const classId = Number(sc[1]);
    const subclass = tooltipText(sc[3]) || null;
    if (classId === 2) return { itemClass: 'weapon', subclass };
    if (classId === 4) return { itemClass: 'armor', subclass };
    return { itemClass: 'other', subclass };
  }
  if (/\bDamage\b/.test(text) && /\bSpeed\b/.test(text)) {
    return { itemClass: 'weapon', subclass: WEAPON_WORDS.exec(text)?.[1] ?? null };
  }
  if (/^\d+ Armor$/m.test(text)) return { itemClass: 'armor', subclass: null };
  return { itemClass: 'other', subclass: null };
}

function parseQualityFromHtml(html: string): number | null {
  const m = /class="q(\d)"/.exec(html);
  return m ? Number(m[1]) : null;
}

export function parseItemTooltip(data: TooltipResponse): ItemFields {
  const html = data.tooltip;
  const text = tooltipText(html);
  const ilvl = /Item Level\s*(?:<!--ilvl-->)?\s*(\d+)/i.exec(html) ?? /Item Level (\d+)/i.exec(text);
  const quality = (data.quality ?? parseQualityFromHtml(html) ?? 1) as Quality;
  const { itemClass, subclass } = parseItemClass(html, text);
  return {
    name: data.name,
    quality: Math.max(0, Math.min(5, quality)) as Quality,
    itemLevel: ilvl ? Number(ilvl[1]) : null,
    itemClass,
    subclass,
    vendorSell: parseSellPrice(html),
    icon: data.icon ?? null,
  };
}

// ---------------------------------------------------------------------------
// Spells
//
// A profession spell tooltip, as served for Forever (see fixtures/spell-*.json):
//   <table> name link, <br />, "5.125 sec cast" </table>
//   <table><tr><td>
//     [Tools:<br /><div class="indent q1"> links to an item search, not an item </div>]
//     Reagents:<br /><div class="indent q1"> <a item=A>..</a>&nbsp;(2), <a item=B>..</a> </div>
//     [<div class="q">Creates ...</div>]
//     <br /><span class="qN"><a item=CREATED>..</a></span> (2)   <- then the created item's own tooltip
//   </td></tr></table>
// Tools are ignored: the crafter is assumed to have them.

const ITEM_LINK = /<a\b[^>]*\bhref="[^"]*?\bitem=(\d+)[^"]*"[^>]*>[\s\S]*?<\/a>/gi;

function parseCastTimeMs(text: string): number {
  if (/\bInstant\b/i.test(text)) return 0;
  const sec = /([\d.]+)\s*sec(?:onds?)?\s*cast/i.exec(text);
  if (sec) return Math.round(Number(sec[1]) * 1000);
  const min = /([\d.]+)\s*min(?:utes?)?\s*cast/i.exec(text);
  if (min) return Math.round(Number(min[1]) * 60_000);
  return 0;
}

/** Reagent links with their "(n)" counts, from the reagent block's inner HTML. */
function parseReagents(block: string): Qty[] {
  const inputs: Qty[] = [];
  const re = new RegExp(ITEM_LINK.source, 'gi');
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const after = block.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const q = /^(?:\s|&nbsp;)*\((\d+)\)/.exec(after);
    const qty = q ? Number(q[1]) : 1;
    const itemId = Number(m[1]);
    const existing = inputs.find((x) => x.itemId === itemId);
    if (existing) existing.qty += qty;
    else inputs.push({ itemId, qty });
  }
  return inputs;
}

export interface ParsedSpell {
  fields: RecipeFields;
  /** Every item ID the recipe references, for on-demand import (REQ-2.1). */
  referencedItems: number[];
  warnings: string[];
}

export function parseSpellTooltip(data: TooltipResponse): ParsedSpell {
  const html = data.tooltip;
  const warnings: string[] = [];

  // Cast time lives in the first table; later text belongs to the created item's tooltip.
  const headerEnd = html.search(/<\/table>/i);
  const header = headerEnd >= 0 ? html.slice(0, headerEnd) : html;

  const reagentMatch = /(?<![\w-])Reagents:\s*(?:<br\s*\/?>\s*)*<div\b[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const inputs = reagentMatch ? parseReagents(reagentMatch[1]) : [];
  if (!reagentMatch) warnings.push('No reagents found.');

  // The created item is the first item link after the reagents. Its quantity defaults to 1: Wowhead
  // shows "(2)" after some created items (white and green alike) and its meaning is unknown.
  const searchFrom = reagentMatch ? reagentMatch.index + reagentMatch[0].length : Math.max(0, headerEnd);
  const createdMatch = new RegExp(ITEM_LINK.source, 'i').exec(html.slice(searchFrom));
  const created = createdMatch ? Number(createdMatch[1]) : null;
  if (created === null) warnings.push('No created item found. Add the output by hand.');

  const fields: RecipeFields = {
    name: data.name,
    kind: 'craft',
    profession: null,
    castTimeMs: parseCastTimeMs(tooltipText(header)),
    inputs,
    tools: [],
    outputs: created !== null ? [{ itemId: created, chance: 1, minQty: 1, maxQty: 1 }] : [],
    outputMode: 'independent',
    requiredSkill: null,
    learnedFrom: [],
    skillRange: null,
  };
  const referencedItems = [...new Set([...inputs.map((i) => i.itemId), ...(created !== null ? [created] : [])])];
  return { fields, referencedItems, warnings };
}

export const wowheadUrl = (type: WowheadType, id: number) => `https://www.wowhead.com/forever/${type}=${id}`;
export const iconUrl = (icon: string) => `https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`;
