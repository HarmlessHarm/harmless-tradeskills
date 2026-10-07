/**
 * Waylaid Crates used to seed favor_crates (data migration 3). Frozen with that migration: change
 * crates in the app, not here. Favor is known for Apprentice (10) and Journeyman (20) crates; crate
 * item IDs and most bundles are not known yet and are filled in from the in-game tooltips.
 */
import type { FavorCrate } from '../engine/types';

const TIERS: [string, number | null][] = [
  ['Apprentice', 10],
  ['Journeyman', 20],
  ['Expert', null],
  ['Artisan', null],
];
const KINDS = ['Fabrics', 'Ingots', 'Parts'];

/** Bundles read from the in-game tooltips so far, by crate name. */
const BUNDLES: Record<string, FavorCrate['bundles']> = {
  'Journeyman Parts': [
    { itemId: 4371, qty: 8 }, // Bronze Tube
    { itemId: 4375, qty: 7 }, // Whirring Bronze Gizmo
    { itemId: 4382, qty: 4 }, // Bronze Framework
    { itemId: 10558, qty: 45 }, // Gold Power Core
  ],
};

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function favorSeedMigration(): string {
  const rows = TIERS.flatMap(([tier, favor]) =>
    KINDS.map((kind) => {
      const short = `${tier} ${kind}`;
      const favorSql = favor === null ? 'NULL' : String(favor);
      return `(${sqlText(`Waylaid Crate: ${short}`)}, NULL, ${favorSql}, ${sqlText(JSON.stringify(BUNDLES[short] ?? []))}, '')`;
    }),
  );
  return `
  CREATE TABLE favor_crates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    item_id INTEGER,
    favor INTEGER,
    bundles TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO favor_crates (name, item_id, favor, bundles, notes) VALUES
    ${rows.join(',\n    ')};
  `;
}

/** Every Waylaid Crate on Wowhead Forever, as of migration 4. Frozen with that migration. */
const ALL_CRATES = [
  ...['Curiosities', 'Fabrics', 'Herbs', 'Ingots', 'Ore', 'Parts', 'Textiles'].flatMap((kind) =>
    ['Apprentice', 'Journeyman', 'Expert', 'Artisan'].filter((t) => !((t === 'Expert' || t === 'Artisan') && kind === 'Herbs')).map((t) => `${t} ${kind}`),
  ),
  'Earthly Expert Herbs',
  'Flowering Expert Herbs',
  'Earthly Artisan Herbs',
  'Flowering Artisan Herbs',
];

const MIGRATION_4_FAVOR: Record<string, number> = { Apprentice: 10, Journeyman: 20 };

/** Data migration 4: add the crates migration 3 did not have, leaving existing ones alone. */
export function favorAllCratesMigration(): string {
  return ALL_CRATES.map((short) => {
    const name = sqlText(`Waylaid Crate: ${short}`);
    const tier = Object.keys(MIGRATION_4_FAVOR).find((t) => short.includes(t));
    const favor = tier ? String(MIGRATION_4_FAVOR[tier]) : 'NULL';
    return `INSERT INTO favor_crates (name, item_id, favor, bundles, notes)
    SELECT ${name}, NULL, ${favor}, '[]', '' WHERE NOT EXISTS (SELECT 1 FROM favor_crates WHERE name = ${name});`;
  }).join('\n');
}
