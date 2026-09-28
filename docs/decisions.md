# Decisions

## DEC-1: One generic transformation graph instead of per-profession calculators
- **Context**: The first calculator was a DE calculator, but more professions and converters will follow over the years.
- **Options considered**: (A) hardcoded calculator per profession; (B) a generic model where every craft, disenchant, conversion (and later prospecting, milling, smelting) is a recipe: items in, items out, optionally with chances.
- **Chosen**: B.
- **Why**: Every future calculator becomes data instead of code. Adding a profession means adding recipes, not writing a new calculator.
- **Rejected**: A, because it does not scale and is not future proof.

## DEC-2: Disenchant results come from rules, not per-item tables
- **Context**: The initial example attached "80% Strange Dust, 20% Lesser Magic Essence" to Heavy Linen Gloves specifically.
- **Options considered**: (A) store DE results per item; (B) store DE rules keyed on quality, item level band and armor vs weapon, and derive an item's DE recipe from its properties.
- **Chosen**: B.
- **Why**: DE outcomes are shared across all items in a bracket. Per-item storage would mean re-entering the same table for many items and getting some wrong. Weapons and armor in the same bracket differ (weapons lean toward essence).
- **Rejected**: A.

## DEC-3: Use real WoW item and spell IDs as identifiers
- **Context**: Needed stable identifiers that survive imports and refreshes.
- **Chosen**: Wowhead/WoW item IDs for items, spell IDs for recipes.
- **Why**: Keeps the door open for importing and refreshing data from external sources without migrating hand-entered data.

## DEC-4: Wowhead as the data source
- **Context**: Recipes, items and prices should not be entered by hand.
- **Options considered**: (A) a custom in-game addon that scans profession windows and merchants and exports SavedVariables; (B) open source vanilla emulator databases (vMaNGOS/CMaNGOS) as seed data; (C) Wowhead's Forever database.
- **Chosen**: C.
- **Why**: Wowhead has a dedicated Forever database that is updated quickly by a large user base. The user does not want to build and maintain an addon for this.
- **Rejected**: A (maintenance burden, not wanted); B (pre-Forever data; Forever demonstrably differs, e.g. Heavy Linen Gloves are green in Forever but white in Classic).
- **Verified**: The JSON tooltip endpoint `https://nether.wowhead.com/forever/tooltip/{item|spell}/{id}` works with plain HTTP. Full item/spell pages return a bot check (HTTP 202, empty body) to plain requests, so page tabs (Sold by, Disenchanting, Created by) are not reachable.

## DEC-5: Fetch lazily and refresh manually, no nightly updater
- **Context**: The user suggested a manual import script or a nightly updater.
- **Options considered**: (A) nightly crawl; (B) fetch an item/recipe on demand when it is first referenced, cache it with `fetchedAt`, plus a per-item refresh and a manual "refresh everything older than X" script.
- **Chosen**: B.
- **Why**: Game data changes with patches, not daily. A nightly crawl is the most likely way to run into Wowhead's terms and rate limits, for no freshness gain.
- **Rejected**: A.

## DEC-6: Source precedence with manual overrides on top
- **Context**: Imported data can be wrong or incomplete; the user wants an option to add or update recipes.
- **Chosen**: Manual overrides win over the Wowhead cache. Records carry `source` and `updatedAt`. (A future "own observations" layer, e.g. logged DE results, would sit between the two.)
- **Why**: Fix mistakes without deleting imported data; always know where a number came from.

## DEC-7: Vendor buy prices and DE rules are manual for the MVP
- **Context**: The Wowhead tooltip endpoint does not expose vendor buy prices or DE result tables; those live on JS-rendered page tabs behind a bot check.
- **Chosen**: Enter vendor buy prices and DE rules manually.
- **Why**: Only a handful of vendor reagents (thread, vial, seed, wood) and a few low-level DE brackets are needed at first. DE rules can be sanity-checked against the DE Tracker addon's lifetime totals (37 uncommon DEs gave 46 Strange Dust and 13 Lesser Magic Essence, roughly consistent with 80/20 at 1 to 2 each).
- **Update**: Vendor buy prices can also be pasted in bulk: copy rows from a vendor's "Sells" table on Wowhead in the browser, and the copied HTML's money spans give each item's cost (Items page, "Vendor prices"). Paste from a vendor that sells at the base price (DEC-8).

## DEC-8: Reputation discounts deferred; store base prices only
- **Context**: Vendor prices can be discounted by reputation with the vendor's faction.
- **Chosen**: Use base prices now. All prices go through a single price-resolver function so modifiers can be added later without data migration.
- **Why**: Keeps the MVP simple while making the later change cheap.
- **Notes for later**: Discounts depend on the vendor's faction, not the item (item -> vendors -> faction -> standing). Never store an observed discounted price as the base price.

## DEC-9: Saved manual workflows instead of a recursive optimizer for the MVP
- **Context**: Originally the engine would recursively search "cheapest way to make X" and "best use of X". The user prefers to pick a known-good route and re-price it rather than search every time.
- **Options considered**: (A) recursive optimizer first; (B) user-defined workflows (fixed routes) evaluated with current prices.
- **Chosen**: B for MVP; optimizer becomes a later version.
- **Why**: Matches how the user plays (known routes like the "DE shuffle"). Evaluating a fixed route is plain arithmetic: no recursion, no cycle handling (essence conversion goes both ways), no search.
- **Rejected for now**: A.

## DEC-10: Uncertainty as simulated percentiles, worst case emphasised
- **Context**: The user wanted EV extended with a 1 or 2 sigma best/worst range; worst case is the most important.
- **Options considered**: (A) EV plus/minus k sigma; (B) Monte Carlo simulation of a batch of N, reporting P5 / median / P95.
- **Chosen**: B.
- **Why**: A single DE is discrete (dust or essence, 1 or 2), so "EV minus 1 sigma" for one item is not a real outcome. Simulation handles discreteness and integer batches, and "95% of batches of 20 do at least this well" is the actual worst-case question.
- **Caveat**: AH price movement is likely a bigger risk than drop variance; an optional pessimistic price per item covers that for now.

## DEC-11: Leftovers ignored for the MVP
- **Context**: Integer batches leave remainders (e.g. 5 essence -> 2 wands + 1 essence).
- **Chosen**: Accept for now; EV is per unit and fractional.
- **Note**: Simulation naturally models integer batches, so leftover handling can come later cheaply.

## DEC-12: Time cost scales with run ratios plus overheads
- **Context**: The user wants workflows to show time (e.g. "make 2 silver in 11 seconds"), either ignoring idle time or adding gaps between actions.
- **Options considered**: (A) sum each step's cast time once; (B) cast time x runs per unit, plus a configurable per-action overhead, plus a per-batch overhead.
- **Chosen**: B.
- **Why**: Per glove the DE shuffle is 2 bolt casts, 1 glove cast, 1 DE, about 1.2 oil casts and 0.15 wand casts, so summing once is wrong. The ratio math already exists for materials. Per-batch overhead (vendor walks, buying, posting) usually dominates small batches and is what makes gold/hour honest.
- **Verified cast times (Forever, Wowhead)**: Heavy Linen Gloves 5.125 s, Disenchant 3 s, Minor Wizard Oil 5 s, Greater Magic Wand 10 s.

## DEC-13: AH fees as a reusable sell channel; flip calculator only
- **Context**: The user wants an AH flip tool: buy price, possible sell price, post duration, profit after fees and deposit.
- **Chosen**: Model AH selling (cut, deposit, duration, faction vs neutral) once as a sell channel used by workflows and the flip calculator. A flip is conceptually a zero-step workflow (buy X on AH, sell X on AH). MVP has the calculator only.
- **Why**: Workflows selling on the AH need the same fee model anyway. For a flip the real worst case is "did not sell", so the calculator focuses on lost deposits and relists.
- **Rejected for now**: flip tracking (saving flips, marking sold/expired). That is really the ledger.

## DEC-14: Calculator before ledger
- **Context**: The original goal included tracking bought and sold items.
- **Chosen**: Ledger (transaction tracking, cost basis, flip tracking) deferred until after MVP.
- **Why**: Calculator and ledger share only the item table. The calculator is useful immediately; manual transaction entry is tedious and likely wants an in-game data source later.

## DEC-15: Recipe drift validation not needed for MVP
- **Context**: Workflows reference recipes; a refreshed recipe could silently break a workflow.
- **Chosen**: Not an MVP concern, since workflows are built and maintained manually.

## DEC-16: Stale route hints deferred
- **Context**: A saved workflow says whether a route is profitable, not whether it is still the best one.
- **Chosen**: Later, once the optimizer exists and more complex flows appear. It should use the same price inputs as workflows.

## DEC-17: Per-item DE logging via a fork of DE Tracker, deferred
- **Context**: The "Disenchant Tracker" addon (DETracker 2.04, BoojiBoy, GPLv3, has a Forever build) only stores lump totals.
- **Findings**: SavedVariables `DE_DB` (per character GUID) holds flat `materials {itemID -> count}`, counts by quality, running vendor/AH value totals and the single most expensive item. In `core.lua` the addon already correlates loot with a specific DE: `UNIT_SPELLCAST_SUCCEEDED` creates `pendingDELoot`, `ITEM_LOCK_CHANGED` reads the source item, `LOOT_READY` captures candidates, `CHAT_MSG_LOOT` credits mats.
- **Planned change (post-MVP)**: add a `DET_Log` SavedVariable; in `ITEM_LOCK_CHANGED` create a log entry `{t, itemID, link, quality, itemLevel, classID, subclassID, sellPrice, mats = {}}` and attach it to the pending object; in `TrackPendingDELootMessage` add received mats to it. Verify event order in game with `/dump DET_Log[#DET_Log]`. Fork must live in its own folder/toc name and the original must be disabled (shared globals `DET`, `/det`, `DE_DB`).
- **Options considered for now**: fork, session-bucketing (reset session, DE one item type), or aggregate sanity checks only.
- **Chosen**: pin until after MVP.

## DEC-18: React + Vite on Vercel, SQLite in the browser
- **Context**: The handoff left stack and storage open. Deployment target is Vercel. The user asked for SQLite.
- **Options considered**: (A) SQLite file on Vercel functions; (B) hosted SQLite (Turso/libSQL) behind Vercel functions; (C) Postgres (Neon); (D) SQLite compiled to WASM (sql.js) running in the browser, persisted to IndexedDB.
- **Chosen**: D.
- **Why**: Vercel functions have an ephemeral, read-only filesystem, so A cannot persist. For a single-user tool, D gives real SQLite with no server, no account, no auth and works offline (NFR-6). Wowhead is reached through a Vercel rewrite (`/wh/*`), so no function is needed.
- **Trade-off**: Data lives in one browser. Settings has .sqlite export/import for backups and moving machines. If multi-device sync is wanted later, B is the natural upgrade: the schema and `Repo` stay the same.

## DEC-19: Workflow unit is a user-chosen item
- **Context**: PRD open question: what is the "unit" for per-unit figures?
- **Chosen**: Each workflow has a unit item. Default: the item fed into the first non-craft step (the gloves that get disenchanted), else the first step's product.
- **Why**: "Per glove" is how the DE shuffle is reasoned about. The solver fixes production of the unit item at 1 and balances every intermediate item, so any produced item works as a unit.

## DEC-20: Buy price limits via a "disenchant any" step
- **Context**: The user wants to know the most they can pay for, say, any uncommon armor of item level 5 to 15 when it gets disenchanted into oil and wands. That is a price to solve for, not a price to enter.
- **Options considered**: (A) a separate calculator tab; (B) a workflow step "disenchant any item of quality Q, armor or weapon, item level L" whose item price is solved for.
- **Chosen**: B.
- **Why**: Everything after the disenchant (oil, wands, vendor buys, time, simulation) is an ordinary workflow, so a tab would duplicate it. Every item in a DE rule band disenchants the same, so one stand-in item per band is exact. The stand-in has a negative ID that encodes quality, type and level, so it never clashes with a WoW ID and needs no storage.
- **Outputs, per item**: break-even (expected profit zero); safe max (the P5 batch, with pessimistic AH prices, breaks even); and the price that still earns a per-workflow target gold per hour, which is the "optimum" since it also pays for the time spent. Profit figures of such a workflow leave the item's cost out. Prices round down to whole copper.
- **Limitation**: One "any item" per workflow gets a limit; a range that spans several rule bands would need a mix of rules and is not modelled.

## DEC-21: Game data and personal data in separate databases
- **Context**: The user wants to share item and recipe data with other players without handing over their workflows and flip favorites.
- **Options considered**: (A) one database with a filtered "share" export; (B) two database files, each with its own migrations.
- **Chosen**: B. `data` holds items, recipes and disenchant rules; `user` holds workflows, flip favorites, price observations and settings. Each file is tagged with a `PRAGMA application_id`, so an import is recognised and replaces only the database it holds.
- **Why**: A shared file is then just the other player's game data export, with nothing to filter. Prices and settings stay personal: prices are observations of one player's market and go stale, and settings include personal time overheads.
- **Migration**: The old combined file (no application_id) is brought up to date with the frozen legacy migrations, copied into both files and the other kind's tables dropped. This happens on first load and when importing an old export.
- **Limitation**: Importing replaces; it does not merge someone else's game data into yours.

## DEC-22: Configurable AH listing rules (lot vs per piece)
- **Context**: The flip calculator assumed every item is listed as its own stack of one, each paying its own deposit. WoW Forever uses the modern AH: commodities are posted as one auction of the whole quantity and bought per unit, gear is posted per piece. The exact deposit and cut rules are not verified in game yet (#19).
- **Chosen**: Keep the fee model generic and put every rule in config: cut and deposit rates per duration and AH type (as before), minimum deposit per auction, whether the deposit is refunded on sale, and a listing mode per item class (`lot` or `perItem`). Defaults: armor and weapons per piece, everything else as a lot, deposit refunded. Settings store when the rules were last checked in game, and the flip page warns until then.
- **Why**: Updating the rules after checking in game is then a Settings change, not a code change (NFR-5). Item class is the only item property we have that separates commodities from gear.
- **Limitation**: A lot is assumed to expire as a whole (worst case); partial sales of a lot are not modelled. Items with the wrong class need a class override on the item. When the deposit is not refunded, workflow profit does not subtract it yet (a warning says so).
