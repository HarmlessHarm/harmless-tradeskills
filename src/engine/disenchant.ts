import { QUALITY_NAMES, type DisenchantRule, type Item, type Quality, type Recipe } from './types';

/** Recipe ID used for a derived disenchant of an item. */
export const deRecipeId = (itemId: number) => `de:${itemId}`;

/** First rule matching quality, item level band and armor vs weapon (REQ-3.1). */
export function findDisenchantRule(rules: DisenchantRule[], item: Item): DisenchantRule | null {
  if (item.itemClass !== 'armor' && item.itemClass !== 'weapon') return null;
  if (item.itemLevel === null) return null;
  const level = item.itemLevel;
  return (
    rules.find(
      (r) => r.quality === item.quality && r.itemClass === item.itemClass && level >= r.ilvlMin && level <= r.ilvlMax,
    ) ?? null
  );
}

/** Derive "disenchant item X" from the matching rule (REQ-3.2, DEC-2). */
export function deriveDisenchantRecipe(
  rules: DisenchantRule[],
  item: Item,
  castTimeMs: number,
): Recipe | null {
  const rule = findDisenchantRule(rules, item);
  if (!rule) return null;
  return {
    id: deRecipeId(item.id),
    spellId: null,
    name: `Disenchant ${item.name}`,
    kind: 'disenchant',
    profession: 'Enchanting',
    castTimeMs,
    inputs: [{ itemId: item.id, qty: 1 }],
    tools: [],
    outputs: rule.outputs.map((o) => ({ ...o })),
    outputMode: 'exclusive',
    requiredSkill: null,
    learnedFrom: [],
    skillRange: null,
  };
}

/**
 * "Any item" of a quality, type and item level stands in for the bought item of a 'disenchant-any'
 * step. Its ID is negative so it never clashes with a WoW item ID, and encodes everything needed to
 * rebuild it: -(quality * 100000 + 10000 if weapon + item level).
 */
export function anyItemId(quality: Quality, itemClass: 'armor' | 'weapon', itemLevel: number): number {
  return -(quality * 100_000 + (itemClass === 'weapon' ? 10_000 : 0) + itemLevel);
}

export const isAnyItem = (itemId: number) => itemId < 0;

/** Wowhead icon of the Disenchant spell, shown for "any item" stand-ins. */
export const DISENCHANT_ICON = 'spell_holy_removecurse';

/** The stand-in item for an "any item" ID. Its name shows the level band of the matching rule. */
export function anyItem(rules: DisenchantRule[], itemId: number): Item | null {
  if (!isAnyItem(itemId)) return null;
  const code = -itemId;
  const quality = Math.floor(code / 100_000) as Quality;
  const itemClass = code % 100_000 >= 10_000 ? 'weapon' : 'armor';
  const itemLevel = code % 10_000;
  const item: Item = {
    id: itemId,
    name: '',
    quality,
    itemLevel,
    itemClass,
    subclass: null,
    vendorSell: null,
    vendorBuy: null,
    icon: DISENCHANT_ICON,
  };
  const rule = findDisenchantRule(rules, item);
  const band = rule ? `ilvl ${rule.ilvlMin}-${rule.ilvlMax}` : `ilvl ${itemLevel}`;
  item.name = `Any ${QUALITY_NAMES[quality].toLowerCase()} ${itemClass}, ${band}`;
  return item;
}
