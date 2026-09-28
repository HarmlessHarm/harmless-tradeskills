import { DEFAULT_CONFIG } from '../config';
import type { EngineData } from '../engine/workflow';
import type { DisenchantRule, Item, PriceObservation, Recipe, Workflow } from '../engine/types';

/** The PRD's "DE shuffle". Prices here are made up for tests. */
export const IDS = {
  linen: 2589,
  bolt: 2996,
  thread: 2320,
  gloves: 4307,
  dust: 10940,
  lme: 10938,
  seed: 17034,
  vial: 3371,
  wood: 4470,
  rod: 6218,
  oil: 20744,
  wand: 11288,
};

const item = (id: number, name: string, extra: Partial<Item> = {}): Item => ({
  id,
  name,
  quality: 1,
  itemLevel: 1,
  itemClass: 'other',
  subclass: null,
  vendorSell: null,
  vendorBuy: null,
  icon: null,
  ...extra,
});

export const items: Item[] = [
  item(IDS.linen, 'Linen Cloth'),
  item(IDS.bolt, 'Bolt of Linen Cloth'),
  item(IDS.thread, 'Coarse Thread', { vendorBuy: 10 }),
  item(IDS.gloves, 'Heavy Linen Gloves', { quality: 2, itemLevel: 10, itemClass: 'armor', vendorSell: 22 }),
  item(IDS.dust, 'Strange Dust'),
  item(IDS.lme, 'Lesser Magic Essence'),
  item(IDS.seed, 'Maple Seed', { vendorBuy: 90 }),
  item(IDS.vial, 'Empty Vial', { vendorBuy: 4 }),
  item(IDS.wood, 'Simple Wood', { vendorBuy: 38 }),
  item(IDS.rod, 'Runed Copper Rod'),
  item(IDS.oil, 'Minor Wizard Oil', { vendorSell: 400 }),
  item(IDS.wand, 'Greater Magic Wand', { quality: 2, itemLevel: 13, itemClass: 'weapon', vendorSell: 1100 }),
];

const craft = (id: string, name: string, castTimeMs: number, inputs: [number, number][], out: number, tools: number[] = []): Recipe => ({
  id,
  spellId: Number(id.split(':')[1]),
  name,
  kind: 'craft',
  profession: null,
  castTimeMs,
  inputs: inputs.map(([itemId, qty]) => ({ itemId, qty })),
  tools,
  outputs: [{ itemId: out, chance: 1, minQty: 1, maxQty: 1 }],
  outputMode: 'independent',
});

export const recipes: Recipe[] = [
  craft('spell:2963', 'Bolt of Linen Cloth', 1000, [[IDS.linen, 2]], IDS.bolt),
  craft('spell:3840', 'Heavy Linen Gloves', 5125, [[IDS.bolt, 2], [IDS.thread, 1]], IDS.gloves),
  craft('spell:25124', 'Minor Wizard Oil', 5000, [[IDS.dust, 1], [IDS.seed, 1], [IDS.vial, 1]], IDS.oil, [IDS.rod]),
  craft('spell:14807', 'Greater Magic Wand', 10000, [[IDS.wood, 1], [IDS.lme, 2]], IDS.wand, [IDS.rod]),
];

export const deRules: DisenchantRule[] = [
  {
    id: 1,
    quality: 2,
    ilvlMin: 5,
    ilvlMax: 15,
    itemClass: 'armor',
    outputs: [
      { itemId: IDS.dust, chance: 0.8, minQty: 1, maxQty: 2 },
      { itemId: IDS.lme, chance: 0.2, minQty: 1, maxQty: 2 },
    ],
    notes: '',
  },
];

export const prices: PriceObservation[] = [{ itemId: IDS.linen, ahPrice: 15, ahPessimistic: null, observedAt: 0 }];

export function engineData(overrides: Partial<EngineData> = {}): EngineData {
  return {
    items: new Map(items.map((i) => [i.id, i])),
    recipes: new Map(recipes.map((r) => [r.id, r])),
    prices: new Map(prices.map((p) => [p.itemId, p])),
    deRules,
    config: { ...DEFAULT_CONFIG, perActionOverheadSec: 0, perBatchOverheadSec: 60, simulationRuns: 4000 },
    ...overrides,
  };
}

export const deShuffle: Workflow = {
  id: 1,
  name: 'DE shuffle',
  notes: '',
  steps: [
    { type: 'recipe', recipeId: 'spell:2963' },
    { type: 'recipe', recipeId: 'spell:3840' },
    { type: 'disenchant', itemId: IDS.gloves },
    { type: 'recipe', recipeId: 'spell:25124' },
    { type: 'recipe', recipeId: 'spell:14807' },
  ],
  unitItemId: null,
  buyMap: {},
  sellMap: {},
  batchSize: 20,
  ahType: 'faction',
  ahDuration: '8h',
  updatedAt: 0,
};
