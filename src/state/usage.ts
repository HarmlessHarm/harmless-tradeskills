import type { EngineData } from '../engine/workflow';
import type { DisenchantRule, Workflow } from '../engine/types';

/** Where catalog records are referenced, so a delete can say what it will break. */
export interface UsageData {
  engine: EngineData;
  workflows: Workflow[];
  deRules: DisenchantRule[];
}

export function itemUsage(d: UsageData, itemId: number): string[] {
  const out: string[] = [];
  for (const r of d.engine.recipes.values()) {
    if (r.inputs.some((i) => i.itemId === itemId)) out.push(`reagent in ${r.name}`);
    else if (r.outputs.some((o) => o.itemId === itemId)) out.push(`made by ${r.name}`);
    else if (r.tools.includes(itemId)) out.push(`tool for ${r.name}`);
  }
  for (const wf of d.workflows) {
    if (wf.unitItemId === itemId || wf.steps.some((s) => s.type === 'disenchant' && s.itemId === itemId)) out.push(`workflow ${wf.name}`);
  }
  if (d.deRules.some((rule) => rule.outputs.some((o) => o.itemId === itemId))) out.push('disenchant rules');
  return out;
}

export function recipeUsage(d: UsageData, recipeId: string): string[] {
  return d.workflows.filter((wf) => wf.steps.some((s) => s.type === 'recipe' && s.recipeId === recipeId)).map((wf) => `workflow ${wf.name}`);
}

/** Confirmation text for deleting one or more records. */
export function deleteConfirmText(what: string, names: string[], usage: string[]): string {
  const head = names.length === 1 ? `Delete ${what} "${names[0]}"?` : `Delete ${names.length} ${what}s?`;
  if (usage.length === 0) return head;
  const shown = [...new Set(usage)];
  const list = shown.slice(0, 8).join('\n  ');
  const more = shown.length > 8 ? `\n  and ${shown.length - 8} more` : '';
  return `${head}\n\nStill used by:\n  ${list}${more}\n\nThose will show it as missing until you import it again.`;
}
