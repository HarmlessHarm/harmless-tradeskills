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
import type { ItemClass, ItemFields, Qty, Quality, RecipeFields } from '../engine/types';

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

interface ItemLink {
  itemId: number;
  index: number;
  end: number;
}

function itemLinks(html: string): ItemLink[] {
  const out: ItemLink[] = [];
  const re = /<a[^>]+href="[^"]*?\bitem=(\d+)[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    out.push({ itemId: Number(m[1]), index: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Everything from a "Label:" marker to the next <br>, closing div, or next known label. */
function section(html: string, label: string): { start: number; end: number } | null {
  // The visible label, not a class name like "whtt-reagents".
  const re = new RegExp(`(?<![\\w-])${label}\\s*:`, 'i');
  const m = re.exec(html);
  if (!m) return null;
  const rest = html.slice(m.index + m[0].length);
  const stop = rest.search(/<br\s*\/?>|<\/div>|<\/td>|(?<![\w-])(?:Reagents|Tools|Requires)\s*:/i);
  return { start: m.index, end: m.index + m[0].length + (stop >= 0 ? stop : rest.length) };
}

function parseCastTimeMs(text: string): number {
  if (/\bInstant\b/i.test(text)) return 0;
  const sec = /([\d.]+)\s*sec(?:onds?)?\s*cast/i.exec(text);
  if (sec) return Math.round(Number(sec[1]) * 1000);
  const min = /([\d.]+)\s*min(?:utes?)?\s*cast/i.exec(text);
  if (min) return Math.round(Number(min[1]) * 60_000);
  return 0;
}

export interface ParsedSpell {
  fields: RecipeFields;
  /** Every item ID the recipe references, for on-demand import (REQ-2.1). */
  referencedItems: number[];
  warnings: string[];
}

export function parseSpellTooltip(data: TooltipResponse): ParsedSpell {
  const html = data.tooltip;
  const text = tooltipText(html);
  const links = itemLinks(html);
  const warnings: string[] = [];

  const reagentSec = section(html, 'Reagents');
  const toolSec = section(html, 'Tools');
  const inside = (l: ItemLink, s: { start: number; end: number } | null) => !!s && l.index >= s.start && l.index < s.end;

  const inputs: Qty[] = [];
  const tools: number[] = [];
  const others: number[] = [];
  for (const link of links) {
    if (inside(link, reagentSec)) {
      // Quantity follows the link as "(n)"; a missing count means 1.
      const after = html.slice(link.end, link.end + 40);
      const q = /^\s*(?:<[^>]+>\s*)*\((\d+)\)/.exec(after);
      const qty = q ? Number(q[1]) : 1;
      const existing = inputs.find((x) => x.itemId === link.itemId);
      if (existing) existing.qty += qty;
      else inputs.push({ itemId: link.itemId, qty });
    } else if (inside(link, toolSec)) {
      if (!tools.includes(link.itemId)) tools.push(link.itemId);
    } else if (!others.includes(link.itemId)) {
      others.push(link.itemId);
    }
  }

  // The created item is the remaining item link. Its quantity defaults to 1: the "(2)" Wowhead shows
  // after green items looks like a quality marker, not a count (see PRD open questions).
  const created = others.find((id) => !inputs.some((i) => i.itemId === id) && !tools.includes(id));
  if (!created) warnings.push('No created item found. Add the output by hand.');
  if (!reagentSec) warnings.push('No reagents found.');

  const fields: RecipeFields = {
    name: data.name,
    kind: 'craft',
    profession: null,
    castTimeMs: parseCastTimeMs(text),
    inputs,
    tools,
    outputs: created ? [{ itemId: created, chance: 1, minQty: 1, maxQty: 1 }] : [],
    outputMode: 'independent',
  };
  const referencedItems = [...new Set([...inputs.map((i) => i.itemId), ...tools, ...(created ? [created] : [])])];
  return { fields, referencedItems, warnings };
}

export const wowheadUrl = (type: WowheadType, id: number) => `https://www.wowhead.com/forever/${type}=${id}`;
export const iconUrl = (icon: string) => `https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`;
