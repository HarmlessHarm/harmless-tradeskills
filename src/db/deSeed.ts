/**
 * Classic disenchant table used to seed de_rules (migration 2). Frozen with that migration: change
 * rules in the app, not here.
 *
 * Chances and quantities are AzerothCore's disenchant_loot_template (entries 1-11 green armor,
 * 21-31 green weapons, 41-48 rare, 61-65 epic). A 0 chance there means "the rest of the group",
 * written out here. Item level bands follow aux-addon's core/disenchant.lua. Both agree with the
 * Enchantrix logs in alex-berliner/wow_classic_de_table. Verify against DE Tracker for Forever.
 */
import type { DisenchantRule, RecipeOutput } from '../engine/types';

type Seed = Omit<DisenchantRule, 'id' | 'notes'>;

const I = {
  strangeDust: 10940,
  soulDust: 11083,
  visionDust: 11137,
  dreamDust: 11176,
  illusionDust: 16204,
  lesserMagic: 10938,
  greaterMagic: 10939,
  lesserAstral: 10998,
  greaterAstral: 11082,
  lesserMystic: 11134,
  greaterMystic: 11135,
  lesserNether: 11174,
  greaterNether: 11175,
  lesserEternal: 16202,
  greaterEternal: 16203,
  smallGlimmering: 10978,
  largeGlimmering: 11084,
  smallGlowing: 11138,
  largeGlowing: 11139,
  smallRadiant: 11177,
  largeRadiant: 11178,
  smallBrilliant: 14343,
  largeBrilliant: 14344,
  nexus: 20725,
};

const out = (itemId: number, chance: number, minQty: number, maxQty: number): RecipeOutput => ({ itemId, chance, minQty, maxQty });

/** [ilvlMin, ilvlMax, dust, dust qty, essence, essence qty, shard, armor chances, weapon chances]; chances are dust, essence, shard. */
type GreenBand = [number, number, number, [number, number], number, [number, number], number | null, [number, number, number], [number, number, number]];

// prettier-ignore
const GREEN: GreenBand[] = [
  //  ilvl    dust              qty     essence             qty     shard                armor %          weapon %
  [1, 15, I.strangeDust, [1, 2], I.lesserMagic, [1, 2], null, [0.8, 0.2, 0], [0.2, 0.8, 0]],
  [16, 20, I.strangeDust, [2, 3], I.greaterMagic, [1, 2], I.smallGlimmering, [0.75, 0.2, 0.05], [0.2, 0.75, 0.05]],
  [21, 25, I.strangeDust, [4, 6], I.lesserAstral, [1, 2], I.smallGlimmering, [0.75, 0.15, 0.1], [0.15, 0.75, 0.1]],
  [26, 30, I.soulDust, [1, 2], I.greaterAstral, [1, 2], I.largeGlimmering, [0.75, 0.2, 0.05], [0.2, 0.75, 0.05]],
  [31, 35, I.soulDust, [2, 5], I.lesserMystic, [1, 2], I.smallGlowing, [0.75, 0.2, 0.05], [0.2, 0.75, 0.05]],
  [36, 40, I.visionDust, [1, 2], I.greaterMystic, [1, 2], I.largeGlowing, [0.75, 0.2, 0.05], [0.2, 0.75, 0.05]],
  [41, 45, I.visionDust, [2, 5], I.lesserNether, [1, 2], I.smallRadiant, [0.75, 0.2, 0.05], [0.2, 0.75, 0.05]],
  [46, 50, I.dreamDust, [1, 2], I.greaterNether, [1, 2], I.largeRadiant, [0.75, 0.2, 0.05], [0.2, 0.75, 0.05]],
  [51, 55, I.dreamDust, [2, 5], I.lesserEternal, [1, 2], I.smallBrilliant, [0.75, 0.2, 0.05], [0.22, 0.75, 0.03]],
  [56, 60, I.illusionDust, [1, 2], I.greaterEternal, [1, 2], I.largeBrilliant, [0.75, 0.2, 0.05], [0.22, 0.75, 0.03]],
  [61, 65, I.illusionDust, [2, 5], I.greaterEternal, [2, 3], I.largeBrilliant, [0.75, 0.2, 0.05], [0.22, 0.75, 0.03]],
];

// prettier-ignore
const RARE: [number, number, RecipeOutput[]][] = [
  [1, 25, [out(I.smallGlimmering, 1, 1, 1)]],
  [26, 30, [out(I.largeGlimmering, 1, 1, 1)]],
  [31, 35, [out(I.smallGlowing, 1, 1, 1)]],
  [36, 40, [out(I.largeGlowing, 1, 1, 1)]],
  [41, 45, [out(I.smallRadiant, 1, 1, 1)]],
  [46, 50, [out(I.largeRadiant, 1, 1, 1)]],
  [51, 55, [out(I.smallBrilliant, 1, 1, 1)]],
  [56, 65, [out(I.largeBrilliant, 0.995, 1, 1), out(I.nexus, 0.005, 1, 1)]],
];

// prettier-ignore
const EPIC: [number, number, RecipeOutput[]][] = [
  [1, 45, [out(I.smallRadiant, 1, 2, 4)]],
  [46, 50, [out(I.largeRadiant, 1, 2, 4)]],
  [51, 55, [out(I.smallBrilliant, 1, 2, 4)]],
  [56, 60, [out(I.nexus, 1, 1, 1)]],
  [61, 94, [out(I.nexus, 1, 1, 2)]],
];

function seeds(): Seed[] {
  const rules: Seed[] = [];
  for (const [ilvlMin, ilvlMax, dust, dq, ess, eq, shard, armor, weapon] of GREEN) {
    for (const [itemClass, [pd, pe, ps]] of [['armor', armor], ['weapon', weapon]] as const) {
      const outputs = [out(dust, pd, ...dq), out(ess, pe, ...eq)];
      if (shard !== null) outputs.push(out(shard, ps, 1, 1));
      rules.push({ quality: 2, ilvlMin, ilvlMax, itemClass, outputs });
    }
  }
  for (const [quality, table] of [[3, RARE], [4, EPIC]] as const) {
    for (const [ilvlMin, ilvlMax, outputs] of table) {
      for (const itemClass of ['armor', 'weapon'] as const) rules.push({ quality, ilvlMin, ilvlMax, itemClass, outputs });
    }
  }
  return rules;
}

export const DE_SEED_NOTE = 'Classic table (AzerothCore), verify for Forever';

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Removes the two starter rules from migration 1 if still untouched, then adds each seed rule
 * unless the user already has a rule for the same quality and type whose band overlaps it.
 */
export function deSeedMigration(): string {
  const inserts = seeds().map((r) => {
    const values = [r.quality, r.ilvlMin, r.ilvlMax, sqlText(r.itemClass), sqlText(JSON.stringify(r.outputs)), sqlText(DE_SEED_NOTE)].join(', ');
    return `INSERT INTO de_rules (quality, ilvl_min, ilvl_max, item_class, outputs, notes)
    SELECT ${values}
    WHERE NOT EXISTS (SELECT 1 FROM de_rules WHERE quality = ${r.quality} AND item_class = ${sqlText(r.itemClass)} AND ilvl_min <= ${r.ilvlMax} AND ilvl_max >= ${r.ilvlMin});`;
  });
  return `
  DELETE FROM de_rules WHERE notes = 'Classic values, unverified for Forever' AND quality = 2 AND ilvl_min = 5 AND ilvl_max = 15 AND (
    (item_class = 'armor' AND outputs = '[{"itemId":10940,"chance":0.8,"minQty":1,"maxQty":2},{"itemId":10938,"chance":0.2,"minQty":1,"maxQty":2}]') OR
    (item_class = 'weapon' AND outputs = '[{"itemId":10940,"chance":0.2,"minQty":1,"maxQty":2},{"itemId":10938,"chance":0.8,"minQty":1,"maxQty":2}]')
  );
  ${inserts.join('\n  ')}
  `;
}
