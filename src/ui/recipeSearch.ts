import type { Item, Recipe } from '../engine/types';

export interface RecipeMatch {
  recipe: Recipe;
  /** Reagent or product names that matched a search term. */
  matchedItems: number[];
}

/**
 * Every term must appear in the recipe name, a reagent name or a product name. Recipes whose
 * own name matches rank first, then the rest by name.
 */
export function searchRecipes(recipes: Recipe[], items: Map<number, Item>, query: string, limit = 50): RecipeMatch[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const itemName = (id: number) => items.get(id)?.name.toLowerCase() ?? '';
  const scored: { match: RecipeMatch; rank: number }[] = [];
  for (const recipe of recipes) {
    const name = recipe.name.toLowerCase();
    const ids = [...new Set([...recipe.inputs.map((i) => i.itemId), ...recipe.outputs.map((o) => o.itemId)])];
    const matchedItems = new Set<number>();
    let nameHits = 0;
    const ok = terms.every((t) => {
      const inName = name.includes(t);
      if (inName) nameHits++;
      const hits = ids.filter((id) => itemName(id).includes(t));
      hits.forEach((id) => matchedItems.add(id));
      return inName || hits.length > 0;
    });
    if (!ok) continue;
    const rank = terms.length === 0 ? 0 : name.startsWith(terms[0]) ? 0 : nameHits === terms.length ? 1 : nameHits > 0 ? 2 : 3;
    scored.push({ match: { recipe, matchedItems: [...matchedItems] }, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.match.recipe.name.localeCompare(b.match.recipe.name))
    .slice(0, limit)
    .map((s) => s.match);
}
