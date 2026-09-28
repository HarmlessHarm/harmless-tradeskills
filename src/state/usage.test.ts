import { describe, expect, it } from 'vitest';
import { deShuffle, deRules, engineData, IDS } from '../test/fixtures';
import { deleteConfirmText, itemUsage, recipeUsage } from './usage';

const data = { engine: engineData(), workflows: [deShuffle], deRules };

describe('usage', () => {
  it('finds where an item is used', () => {
    expect(itemUsage(data, IDS.bolt)).toEqual(['made by Bolt of Linen Cloth', 'reagent in Heavy Linen Gloves']);
    expect(itemUsage(data, IDS.gloves)).toEqual(['made by Heavy Linen Gloves', 'workflow DE shuffle']);
    expect(itemUsage(data, IDS.dust)).toEqual(['reagent in Minor Wizard Oil', 'disenchant rules']);
    expect(itemUsage(data, 999)).toEqual([]);
  });

  it('finds workflows that use a recipe', () => {
    expect(recipeUsage(data, 'spell:3840')).toEqual(['workflow DE shuffle']);
    expect(recipeUsage(data, 'local:1')).toEqual([]);
  });

  it('builds confirm text', () => {
    expect(deleteConfirmText('item', ['Linen Cloth'], [])).toBe('Delete item "Linen Cloth"?');
    expect(deleteConfirmText('recipe', ['A', 'B'], ['workflow X', 'workflow X'])).toBe(
      'Delete 2 recipes?\n\nStill used by:\n  workflow X\n\nThose will show it as missing until you import it again.',
    );
  });
});
