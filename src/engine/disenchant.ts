import type { DisenchantRule, Item, Recipe } from './types';

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
  };
}
