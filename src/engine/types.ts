/** All money values are integer copper (NFR-2). All IDs are real WoW IDs (DEC-3). */

export type Copper = number;

export type Quality = 0 | 1 | 2 | 3 | 4 | 5;
export const QUALITY_NAMES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] as const;

export type ItemClass = 'armor' | 'weapon' | 'other';

export type Source = 'wowhead' | 'manual';

/** Fields that can be imported from Wowhead and overridden by hand (DEC-6). */
export interface ItemFields {
  name: string;
  quality: Quality;
  itemLevel: number | null;
  itemClass: ItemClass;
  /** e.g. "Cloth", "Dagger". Informational. */
  subclass: string | null;
  /** Vendor sell price (what a vendor pays you). */
  vendorSell: Copper | null;
  icon: string | null;
}

export interface ItemRecord {
  id: number;
  /** Values as imported (or first entered by hand). */
  imported: ItemFields;
  /** Manual overrides; win over imported values. */
  overrides: Partial<ItemFields>;
  /** Manual vendor buy price (what a vendor charges you). Always a base price (DEC-8). */
  vendorBuy: Copper | null;
  source: Source;
  fetchedAt: number | null;
  updatedAt: number;
  rawTooltip: string | null;
}

/** The effective view of an item: imported values with overrides applied. */
export interface Item extends ItemFields {
  id: number;
  vendorBuy: Copper | null;
}

export interface Qty {
  itemId: number;
  qty: number;
}

export interface RecipeOutput {
  itemId: number;
  /** 0..1, a normal craft is 1. */
  chance: number;
  minQty: number;
  maxQty: number;
}

/** Recipe kinds are open ended strings so new kinds need no engine change (REQ-2.4). */
export type RecipeKind = 'craft' | 'disenchant' | 'convert' | (string & {});

export interface RecipeFields {
  name: string;
  kind: RecipeKind;
  profession: string | null;
  castTimeMs: number;
  inputs: Qty[];
  /** Required but not consumed. */
  tools: number[];
  outputs: RecipeOutput[];
  /**
   * 'independent': each output rolls its own chance (a normal craft, bonus procs).
   * 'exclusive': one roll picks exactly one output, e.g. disenchanting. Chances should sum to 1 or less.
   */
  outputMode: 'independent' | 'exclusive';
}

export interface RecipeRecord {
  /** "spell:3840" for imported, "local:<n>" for hand made. */
  id: string;
  spellId: number | null;
  imported: RecipeFields;
  overrides: Partial<RecipeFields>;
  source: Source;
  fetchedAt: number | null;
  updatedAt: number;
  rawTooltip: string | null;
}

export interface Recipe extends RecipeFields {
  id: string;
  spellId: number | null;
}

export interface DisenchantRule {
  id: number;
  quality: Quality;
  ilvlMin: number;
  ilvlMax: number;
  itemClass: 'armor' | 'weapon';
  outputs: RecipeOutput[];
  notes: string;
}

export interface PriceObservation {
  itemId: number;
  ahPrice: Copper | null;
  /** Optional min AH sell price, used for the worst case (REQ-4.2). */
  ahMin: Copper | null;
  observedAt: number;
}

export type AhType = 'faction' | 'neutral';
export type BuySource = 'ah' | 'vendor';
export type Disposition = 'ah' | 'vendor' | 'keep';

/**
 * A workflow step references a recipe, or derives a disenchant recipe for an item (REQ-3.2).
 * 'disenchant-any' disenchants any item of a quality, type and item level band: the item is bought
 * at a price the workflow solves for (its buy limit) instead of a set price.
 */
export type WorkflowStep =
  | { type: 'recipe'; recipeId: string }
  | { type: 'disenchant'; itemId: number }
  | { type: 'disenchant-any'; quality: Quality; itemClass: 'armor' | 'weapon'; itemLevel: number };

export interface Workflow {
  id: number;
  name: string;
  notes: string;
  steps: WorkflowStep[];
  /** Item the per-unit figures are expressed in. null means the default. */
  unitItemId: number | null;
  buyMap: Record<number, BuySource>;
  sellMap: Record<number, Disposition>;
  batchSize: number | null;
  ahType: AhType;
  ahDuration: string;
  /** Gold per hour to aim for when solving the buy limit of a 'disenchant-any' step. */
  targetGoldPerHour: Copper | null;
  updatedAt: number;
}

export interface AhDuration {
  key: string;
  label: string;
  /** Deposit as a fraction of the vendor sell price, per AH type. */
  depositRate: Record<AhType, number>;
}

/**
 * How items are posted on the AH (DEC-22). 'lot': the whole quantity is one auction with one deposit
 * and buyers take any number of units (commodities). 'perItem': every piece is its own auction.
 */
export type ListingMode = 'lot' | 'perItem';

export interface Config {
  /** AH cut on sale, as a fraction, per AH type. */
  ahCut: Record<AhType, number>;
  durations: AhDuration[];
  /** Minimum deposit per auction, in copper. */
  minDeposit: Copper;
  /** Whether the deposit comes back when the auction sells (REQ-5.2). It is always lost on expiry. */
  depositRefundedOnSale: boolean;
  /** How each item class is posted. */
  listingMode: Record<ItemClass, ListingMode>;
  /** When the AH rules above were last checked in game, as epoch ms. null means unverified. */
  ahRulesVerifiedAt: number | null;
  /** Profit wanted on a flip, as a fraction of the buy price. Sets the watchlist's "buy below". */
  flipTargetMargin: number;
  /** Seconds of idle time added to every action (cast). */
  perActionOverheadSec: number;
  /** Seconds added once per batch (vendor walks, buying, posting). */
  perBatchOverheadSec: number;
  defaultBatchSize: number;
  simulationRuns: number;
  /** Cast time of Disenchant, used for derived DE recipes. */
  disenchantCastMs: number;
}

/**
 * Flip settings remembered for an item (REQ-7.3): the prices and settings last used for it.
 * `favorite: false` keeps the settings of an item that is on the watchlist only because a workflow
 * trades it; a missing flag (older data) means a favorite.
 */
export interface FlipFavorite {
  favorite?: boolean;
  itemId: number;
  buyPrice: Copper | null;
  sellPrice: Copper | null;
  durationKey: string;
  ahType: AhType;
  /** Number of items flipped. Older favorites have none and use 1. */
  qty?: number;
}
