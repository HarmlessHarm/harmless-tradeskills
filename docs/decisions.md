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
- **Chosen**: B. `data` holds items, recipes and disenchant rules; `user` holds workflows, flip favorites, price observations and settings (AH prices later moved to their own shareable database: DEC-23, DEC-27). Each file is tagged with a `PRAGMA application_id`, so an import is recognised and replaces only the database it holds.
- **Why**: A shared file is then just the other player's game data export, with nothing to filter. Prices and settings stay personal: prices are observations of one player's market and go stale, and settings include personal time overheads.
- **Migration**: The old combined file (no application_id) is brought up to date with the frozen legacy migrations, copied into both files and the other kind's tables dropped. This happens on first load and when importing an old export.
- **Limitation**: Importing replaces; it does not merge someone else's game data into yours.

## DEC-22: Configurable AH listing rules (lot vs per piece)
- **Context**: The flip calculator assumed every item is listed as its own stack of one, each paying its own deposit. WoW Forever uses the modern AH: commodities are posted as one auction of the whole quantity and bought per unit, gear is posted per piece. The exact deposit and cut rules are not verified in game yet (#19).
- **Chosen**: Keep the fee model generic and put every rule in config: cut and deposit rates per duration and AH type (as before), minimum deposit per auction, whether the deposit is refunded on sale, and a listing mode per item class (`lot` or `perItem`). Defaults: armor and weapons per piece, everything else as a lot, deposit refunded. Settings store when the rules were last checked in game, and the flip page warns until then.
- **Why**: Updating the rules after checking in game is then a Settings change, not a code change (NFR-5). Item class is the only item property we have that separates commodities from gear.
- **Limitation**: A lot is assumed to expire as a whole (worst case); partial sales of a lot are not modelled. Items with the wrong class need a class override on the item. When the deposit is not refunded, workflow profit does not subtract it yet (a warning says so).

## DEC-23: AH price snapshots in their own shareable database
- **Context**: The flipper needs more than one price per item: the AH holds hundreds of units per price level, from the cheap tail up to listings at silly prices (#19). Manual entry must stay quick, and addon scans (#14, #18) must fit the same history later. The user wants to share this price data with other players, without their personal data.
- **Chosen**: A third database file, `prices` (application_id 'HTSP'), next to `data` and `user`, with its own migrations, IndexedDB key, export, import and clear. It holds `price_snapshots`: per item and moment the cheap end of the order book as (price, qty) rows, the total quantity when known, faction or neutral AH, a `source` (manual or addon), a `truncated` flag and a stable `uid` so a re-imported or shared snapshot is stored once. Min price, min quantity, market value and confidence are stored next to the rows and can be recomputed from them.
- **Market value**: the quantity-weighted mean of the cheapest 15% of units, continued to 30% until the price steps up by more than 20%. Listings above that never count, which filters overpriced noise. It is 'solid' when the rows cover 15% of a known total, otherwise 'partial' (a few rows typed in by hand) and counts half in the typical price (weighted median over snapshots). Addon scans keep rows up to the cheapest half of units or twice the market value.
- **Scope**: At first only the flipper used snapshots; since DEC-27 every AH price in the app is a snapshot.
- **Limitation**: At first importing a prices file replaced the local one; since DEC-28 prices are added, never replaced.

## DEC-24: Flip watchlist instead of favorites chips and one form
- **Context**: The flip page showed favorites as chips and one calculation at a time, which wastes space and hides comparisons (#19).
- **Chosen**: One table with a row per watched item: favorites plus items any workflow buys or sells on the AH (found from the workflow's buy and sell choices, "any item" stand-ins excluded). Prices come from AH price snapshots (DEC-23) for the row's AH type. The calculator opens inline under a row. Per-item settings stay in the existing flip favorites list, which gains a `favorite` flag: `false` keeps the settings of a workflow item without starring it; a missing flag (older data) means a favorite.
- **Buy below**: the largest buy price per item that still makes the target margin on cost after the cut, any deposit spent on sale and one lost deposit (one expiry), for the row's quantity and listing mode. Conservative on purpose: manual prices are thin.
- **Sell at** defaults to the typical price (market based), not cost plus markup.
- **Deferred**: holdings and average cost columns come with the ledger (#19 step 5); entering snapshots from the page comes in step 4.

## DEC-25: Manual price entry: a few numbers from the search result
- **Context**: The AH shows hundreds of units per price level. Typing the whole book is not realistic, but a single price hides how deep the cheap end is (#19 step 4).
- **Chosen**: One required field, the lowest price. Optional: the quantity at that price, the available count (both visible in the search result without opening the item), and more rows in a compact `qty x price` notation. A missing quantity at the lowest price counts as 1. The snapshot is truncated unless its rows add up to the available count; its market value is 'solid' once the rows cover 15% of the available count, otherwise 'partial' and it counts half in the typical price. Unreadable row text blocks saving and is named, never guessed.
- **Chart**: lowest price per snapshot as dots over time (filled = solid, hollow = partial), with the typical price and "buy below" as labelled reference lines, hover or focus for the numbers; the list under it is the table view.

## DEC-26: Manual flip ledger with moving-average cost, FIFO as a view
- **Context**: #19 asks for a minimal ledger before addon data exists (first part of #16), and supersedes DEC-14's "calculator only" for flips.
- **Chosen**: A `flip_transactions` table in the personal database (the ledger is personal, unlike prices). Each row: item, kind (buy, sell, adjust), signed qty for adjustments, unit price, fee (the AH cut on a sell, recorded when logged so a later cut change does not rewrite history), AH type, time, `source` (manual now, addon later) and a unique `uid` so imports can skip rows already logged. Holdings and profit are replayed from the rows, never stored.
- **Cost basis**: weighted moving average by default (a buy moves the average; sells and removals do not). FIFO is a setting that replays the same rows: oldest units leave first, so remaining stock sits at the latest buy prices. Totals agree once everything is sold. Negative adjustments remove stock at cost without counting as profit; positive ones add stock at a given value (0 by default). Units sold beyond what was logged count at zero cost and are flagged.
- **Unrealized** = holdings x typical price after the AH cut - cost of the holdings. Past purchase price is sunk: if the market dropped, this goes negative rather than hiding it.
- **Not yet**: lost deposits of expired relists are not logged; the price floor warning and portfolio summary are step 6.

## DEC-27: One AH price source: workflows and items read price snapshots
- **Context**: After DEC-23 the app had two AH price stores: snapshots for flipping (prices database) and one current price per item in `price_observations` (personal database) for workflows and the Items page. The same item could show two prices, and workflow prices could not be shared (#19 step 7).
- **Chosen**: Every AH price is a price snapshot, per item and AH type. Typing a price in the Items page or a workflow records a one-row manual snapshot. Workflows and the Items page get one price per item and AH from the snapshots by a rule in Settings: 'latest' (the newest snapshot's market value; the default, as before) or 'typical' (the typical price over all snapshots). Workflows now price on their own AH (faction or neutral); the Items page shows the faction AH. The price resolver (REQ-4.3) takes the AH type.
- **Min AH price**: a worst-case assumption you set, not an observation, so it stays personal: an `ah_min_prices` table (one per item) in the personal database, filled from the latest old observations by a migration.
- **Migration**: `price_observations` is emptied into snapshots and dropped by `Repo.moveLegacyPrices`, run whenever the databases are opened or replaced, so an imported old personal export converts too. Old prices become one-row manual snapshots on the faction AH (the old store had no AH type), with a uid from item, time and price, so moving the same old data twice adds nothing.
- **Trade-off**: A price cannot be cleared from a cell any more; snapshots are history, so a newer one replaces it, and a wrong one is deleted from the flip watchlist's price list.

## DEC-28: Import per kind; AH prices are added, never replaced
- **Context**: One "Import" button replaced whatever kind of data the file held. For AH prices shared by another player that would wipe your own (#19 follow-up).
- **Chosen**: One button per kind. **Import game data** and **Import personal data** replace, as before (restore a backup, move machines); a legacy combined file is accepted by either. **Add pricing data** merges: snapshots whose `uid` you already have are skipped, so your prices never change and adding the same file twice adds nothing. Each button checks the file's kind first and refuses a wrong one before asking anything.
- **Who recorded a price**: Every snapshot stores an `owner`, a random player id kept in personal data (so restoring personal data restores it). Snapshots from before ids are claimed as yours on load. When adding, snapshots with your id come back as yours (restoring your own AH prices export); anyone else's are marked with `origin` (the file they came from, kept through re-sharing) and shown as "shared". **Remove added prices** deletes every snapshot with an origin; yours stay.
- **Limits**: Clearing personal data without a backup creates a new player id, after which an old AH prices export of yours counts as shared. The id is random and says nothing about the player; it travels with shared prices files.

## DEC-29: Characters know trainer recipes by skill, other recipes by hand
- **Context**: Workflows should show which of your characters can do each step (#21). The game has no API we can read yet; an addon export comes later (#10, #11).
- **How a recipe is learned is game data**: every recipe stores `learnedFrom` (trainer, vendor, drop, quest, other; a recipe can have several), `requiredSkill` and `skillRange` (the skill levels where it turns orange, yellow, green and grey; some recipes have no orange tier). They come from a pasted Wowhead recipe table in bulk import (the Source column and the skill column's `r1` to `r4` spans), are stored as base values also on recipes you already have, survive a refresh from the tooltip, and can be edited. Missing recipes are added on the Recipes page like any other.
- **Characters are personal data**: name, ruleset (PvE, PvP or RP: Forever has no realms, each ruleset is a megaserver with linked auction houses), faction, level, notes and professions with skill, plus a `character_recipes` row per recipe learned by hand.
- **Chosen rule**: a character knows a recipe of one of its professions when it is a trainer recipe and the skill is at least the required skill (assumed trained, not stored), or when it is marked as learned. Vendor, drop and quest recipes are only known when marked. Disenchanting counts as known with Enchanting; its skill limits per item level are not modelled yet.
- **Later**: an addon scan replaces the rule for a scanned character (the `source` column on `character_recipes` is there for it); skill-up colors per character, swap plans and faction checks in workflows build on the same data.

## DEC-30: Merchant Favor calculator from Waylaid Crates
- **Context**: Merchant Favor is a new currency that buys recipes. You get it by filling a Waylaid Crate (found in the world or bought on the AH) with any one bundle of trade goods from its tooltip, such as 4 Bronze Framework. Apprentice crates give 10 favor, Journeyman 20; Expert and Artisan are not known yet.
- **Crates are game data**: a `favor_crates` table in the data database: name, the crate's item (for its AH price), favor, bundles (item and quantity, any one fills the crate) and notes. Seeded with the twelve crates (Apprentice to Artisan, Fabrics, Ingots and Parts) and the Journeyman Parts bundles; crate item IDs, unknown favor and the other bundles are filled in from the app.
- **Cost of favor** = (crate AH price + cheapest bundle) / favor. A bundle item is bought at the cheaper of its AH price (on the chosen AH) and a vendor price. The crate counts at its AH price by default, even when found, because it could be sold instead; a toggle makes it free. A crate without an AH price is left out of the total and marked "+ crate", so the bundles still compare.
- **Later**: price a bundle at its crafting cost from a workflow instead of only buying it.
