import type { Item, ItemRecord, Recipe, RecipeRecord } from './types';

/** Overrides win over imported values (DEC-6). */
export function effectiveItem(r: ItemRecord): Item {
  return { ...r.imported, ...r.overrides, id: r.id, vendorBuy: r.vendorBuy };
}

export function effectiveRecipe(r: RecipeRecord): Recipe {
  return { ...r.imported, ...r.overrides, id: r.id, spellId: r.spellId };
}

export function expectedQty(o: { chance: number; minQty: number; maxQty: number }): number {
  return o.chance * ((o.minQty + o.maxQty) / 2);
}
