# Harmless Tradeskills

A personal, data-driven profession toolbox for WoW Forever: model crafting, disenchanting and auction house flips once, then see what a route earns, how long it takes and what the worst case looks like.

Product docs live in [`docs/`](docs): [PRD](docs/prd.md), [architecture](docs/architecture.md), [decisions](docs/decisions.md).

## What it does

- **Workflows**: saved routes such as the DE shuffle (linen to bolts to gloves, disenchant, dust and essence into oil and wands). The engine links steps, solves runs per unit, and shows profit per unit, time, gold per hour and a simulated P5 / median / P95 for a batch, with the worst case up front.
- **AH flip**: profit after the cut, deposit lost per failed listing, and how many relists a flip can absorb.
- **Items and recipes**: paste a Wowhead Forever link or ID to import. Missing reagents are imported on demand. For many at once, select rows in any Wowhead table, copy, and paste into Bulk import. Any field can be overridden by hand; overrides survive refreshes.
- **Disenchant rules**: a hand-maintained table by quality, item level and armor vs weapon. Any matching item can be a "Disenchant X" step.
- **Settings**: AH cut and deposit rates, overheads, batch size, bulk refresh of old Wowhead data, and .sqlite export/import.

## Stack

- React + Vite + TypeScript, deployed on Vercel.
- SQLite in the browser: [sql.js](https://sql.js.org) (SQLite compiled to WASM), saved to IndexedDB after every change. There is no backend database; data lives in the browser you use, so export a backup from Settings now and then. See DEC-18 in [decisions](docs/decisions.md) for why.
- Wowhead: the Forever tooltip endpoint is reached through a same-origin path, `/wh/{item|spell}/{id}`. In development `vite.config.ts` proxies it, on Vercel a rewrite in `vercel.json` does. All Wowhead knowledge is in `src/wowhead/adapter.ts`.
- Money is integer copper everywhere.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: engine, Wowhead parsing, database
npm run build      # typecheck + production build
```

## Code map

| Path | What |
| --- | --- |
| `src/engine/` | Pure calculation: types, money, price resolver, AH channel, disenchant rules, workflow solver and simulation |
| `src/wowhead/adapter.ts` | The only module that talks to or parses Wowhead |
| `src/db/` | SQLite schema and migrations, typed repository, browser persistence |
| `src/state/` | React store, on-demand importer, small write helpers |
| `src/ui/` | Pages and shared components |
| `src/config.ts` | Default game rules (AH cut, deposits, overheads) |

## Still to verify

- **Wowhead parsing** was written against the documented response shape, not live responses (the build environment cannot reach Wowhead). Import a few items and recipes and check them; each record keeps its raw tooltip for comparison. If something parses wrong, the fix goes in `src/wowhead/adapter.ts`, and the test fixtures in `adapter.test.ts` should be replaced with real captured responses.
- **AH cut and deposit rates** are Classic placeholders. Check them in game and update them in Settings.
- **Disenchant rules** are seeded with Classic values for uncommon items level 5 to 15. Check against DE Tracker totals.
