import { describe, expect, it } from 'vitest';
import type { Repo } from '../db/repo';
import { freshRepo } from '../test/db';
import { createManualItem } from './actions';
import { importCrates, syncCratesFromCatalog } from './favorImport';

/** A repo whose catalog has the Journeyman Parts trade goods. */
async function repoWithGoods(): Promise<Repo> {
  const repo = await freshRepo();
  for (const [id, name] of [
    [4371, 'Bronze Tube'],
    [4375, 'Whirring Bronze Gizmo'],
    [4382, 'Bronze Framework'],
    [10558, 'Gold Power Core'],
  ] as const)
    createManualItem(repo, id, name);
  return repo;
}

/** A crate tooltip shaped like Wowhead's: the use text is a spell link with <br /> separated lines. */
const crateTooltip = (lines: string[]) =>
  `<table><tr><td><b class="q1">Waylaid Crate: Journeyman Parts</b><br />Item Level 1<br />Requires Level 10<br />` +
  `<span class="q2">Use: <a href="/forever/spell=1300001" class="q2">Fill the crate with any bundle from the following list:<br />` +
  lines.map((l) => `- ${l}`).join('<br />') +
  `</a></span><br /><span class="q">Crafting Reagent</span><br />Max Stack: 5</td></tr></table>`;

const tooltips: Record<string, { name: string; tooltip: string }> = {
  '900': { name: 'Waylaid Crate: Journeyman Parts', tooltip: crateTooltip(['8 Bronze Tube', '7 Whirring Bronze Gizmo', '4 Bronze Framework', '45 Gold Power Core', '3 Imaginary Widget']) },
  '901': { name: 'Waylaid Crate: Expert Ore', tooltip: crateTooltip([]) },
  '902': { name: 'Waylaid Crate: Earthly Mystery Herbs', tooltip: crateTooltip(['20 Peacebloom']) },
  '4371': { name: 'Bronze Tube', tooltip: '<b>Bronze Tube</b>' },
};
const fetcher = async (url: string) => {
  const id = url.split('/').pop()!;
  return new Response(JSON.stringify(tooltips[id] ?? { error: 'not found' }));
};

describe('importCrates', () => {
  it('links crate items to their crates and reads bundles by name', async () => {
    const repo = await repoWithGoods();
    const res = await importCrates(repo, [900, 901, 902, 4371, 999], () => {}, fetcher);
    expect(res.errors).toHaveLength(1);
    expect(res.ignored).toEqual(['Bronze Tube']);

    const crates = repo.listFavorCrates();
    const parts = crates.find((c) => c.name === 'Waylaid Crate: Journeyman Parts')!;
    expect(parts.itemId).toBe(900);
    expect(parts.favor).toBe(20);
    expect(parts.bundles.map((b) => b.itemId)).toEqual([4371, 4375, 4382, 10558]);
    expect(res.crates.find((c) => c.name === parts.name)?.unmatched).toEqual([{ qty: 3, name: 'Imaginary Widget' }]);

    // A tooltip without a bundle list keeps the crate's bundles; an unknown crate is added.
    expect(crates.find((c) => c.name === 'Waylaid Crate: Expert Ore')).toMatchObject({ itemId: 901, favor: null, bundles: [] });
    expect(res.crates.find((c) => c.name === 'Waylaid Crate: Earthly Mystery Herbs')).toMatchObject({ created: true });
    expect(crates).toHaveLength(31);
  });

  it('matches again once a missing trade good is in the catalog', async () => {
    const repo = await repoWithGoods();
    await importCrates(repo, [900], () => {}, fetcher);
    createManualItem(repo, 777, 'Imaginary Widget');
    const [sync] = syncCratesFromCatalog(repo);
    expect(sync).toMatchObject({ matched: 5, unmatched: [], created: false });
    expect(repo.listFavorCrates().find((c) => c.itemId === 900)?.bundles.at(-1)).toEqual({ itemId: 777, qty: 3 });
  });
});
