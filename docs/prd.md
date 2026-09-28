# PRD: WoW Forever Profession Toolbox (MVP)

## Summary
A personal, data-driven calculator for WoW Forever professions. Items and recipes are imported from Wowhead's Forever database by ID; disenchant rules, vendor buy prices and current prices are entered manually. The user saves known money-making routes as workflows and re-prices them to see profit, time, gold/hour and a worst-case range. A standalone AH flip calculator covers buy-and-relist decisions. Everything is modelled as one generic transformation graph so new professions and converters are data, not code [ref: DEC-1].

## Background & context
- WoW Forever is Blizzard's permanent "Classic+" version: level cap 60, new zones, recipes, reputations and revamped systems. Beta runs until 21 October 2026, launch is 4 November 2026. Data differs from Classic (e.g. Heavy Linen Gloves are green, DE-able, in Forever and white in Classic).
- Motivating example, the "DE shuffle":
  - 2 Linen Cloth -> 1 Bolt of Linen Cloth (x2)
  - 2 Bolt of Linen Cloth + 1 Coarse Thread -> Heavy Linen Gloves
  - Disenchant gloves -> ~80% Strange Dust / ~20% Lesser Magic Essence, 1 to 2 each
  - Strange Dust + Maple Seed + Empty Vial -> Minor Wizard Oil (tool: Runed Copper Rod)
  - Simple Wood + 2 Lesser Magic Essence -> Greater Magic Wand (tool: Runed Copper Rod)
  - Oil and wand are sold to a vendor; seed, vial, wood and thread are bought from a vendor.
- Wowhead's tooltip JSON endpoint has been verified to return item and recipe data for Forever [ref: DEC-4].
- The DE Tracker addon is installed and gives lifetime DE totals usable for sanity-checking DE rules [ref: DEC-7, DEC-17].

## Goals
- Decide in seconds whether a known route is worth running today, including its worst case.
- Add a new item or recipe by pasting a Wowhead link, without code changes.
- Know the true profit of an AH flip after cut and deposit, and how many failed relists it can absorb.
- Keep the model general enough to grow over years of play.

## Non-goals
- Recursive route optimizer / "best use of X" search (later version) [ref: DEC-9].
- Ledger: tracking actual buys, sells, cost basis, or saved flips (later) [ref: DEC-13, DEC-14].
- Per-item DE logging and the DE Tracker fork (later) [ref: DEC-17].
- Reputation discounts (later) [ref: DEC-8].
- Stale route hints (later) [ref: DEC-16].
- Leftover handling for integer batches in EV (later) [ref: DEC-11].
- Recipe drift validation (not needed while workflows are manual) [ref: DEC-15].
- Automated vendor buy price or DE table import (not reachable via the tooltip endpoint) [ref: DEC-7].
- Multi-user use; this is a personal tool.

## Requirements

- **REQ-1** (MUST): Item catalog keyed by real WoW item ID. [ref: DEC-3]
  - **REQ-1.1**: Import an item from Wowhead by ID or pasted Wowhead URL: name, quality, item level, armor/weapon type, vendor sell price. [ref: DEC-4]
  - **REQ-1.2**: Fetch lazily on first reference and cache with a fetched timestamp. [ref: DEC-5]
  - **REQ-1.3** (SHOULD): Per-item refresh, plus a manual bulk refresh of records older than a chosen age. [ref: DEC-5]
  - **REQ-1.4**: Manual fields and overrides on any item field; overrides win over imported values; each record shows its source and last update. [ref: DEC-6]
  - **REQ-1.5**: Manual vendor buy price per item. [ref: DEC-7]
- **REQ-2** (MUST): Recipes keyed by spell ID, generic across professions. [ref: DEC-1, DEC-3]
  - **REQ-2.1**: Import a recipe from Wowhead by spell ID or pasted URL: reagents with item IDs and quantities, tools (required, not consumed), created item, cast time. Missing items are imported on demand. [ref: DEC-4]
  - **REQ-2.2**: Outputs support chance and min/max quantity (a normal craft is chance 1, quantity 1).
  - **REQ-2.3**: Recipes can be created and edited by hand and overridden. [ref: DEC-6]
  - **REQ-2.4**: Recipe kinds include craft, disenchant and convert; new kinds can be added without changing the engine.
- **REQ-3** (MUST): Disenchant rules. [ref: DEC-2, DEC-7]
  - **REQ-3.1**: Manually maintained rule table keyed on quality, item level range and armor vs weapon, mapping to outputs with chance and min/max quantity.
  - **REQ-3.2**: A disenchant recipe is derived for any item matching a rule, so a workflow step can be "disenchant item X".
- **REQ-4** (MUST): Prices.
  - **REQ-4.1**: Manual price entry per item for AH price, with timestamp so staleness is visible. Vendor buy/sell prices come from REQ-1.
  - **REQ-4.2** (SHOULD): Optional min AH price per item, used for worst-case figures. [ref: DEC-10]
  - **REQ-4.3**: All price lookups go through one resolver function so modifiers (e.g. reputation) can be added later. Stored vendor prices are always base prices. [ref: DEC-8]
- **REQ-5** (MUST): AH fee model as a reusable sell channel. [ref: DEC-13]
  - **REQ-5.1**: Cut on sale, deposit per listing duration, faction vs neutral AH; rates in configuration, not code.
  - **REQ-5.2**: Deposit is lost on expiry. Whether it is refunded on sale is a setting (default: refunded).
  - **REQ-5.3**: Per item class (armor, weapon, other), a setting says whether a quantity is posted as one auction with one deposit (a lot, like commodities on the modern AH) or as one auction per piece. The minimum deposit applies per auction. [ref: DEC-22]
  - **REQ-5.4**: Settings record when the AH rules were last checked in game; until then the app flags them as unverified.
- **REQ-6** (MUST): Workflows. [ref: DEC-9]
  - **REQ-6.1**: Create, save, edit and delete workflows: an ordered list of recipe steps, a buy source (AH or vendor) for every input no step produces, and a disposition (AH, vendor, keep) for every output no step consumes.
  - **REQ-6.2**: The engine links steps automatically: an input produced by an earlier step comes from that step, otherwise it is bought.
  - **REQ-6.3**: The engine computes runs per unit for each step from recipe quantities and expected outputs (e.g. per glove: 2 bolt crafts, 1 DE, ~1.2 oils, ~0.15 wands).
  - **REQ-6.4**: Show expected profit per unit using current prices and the AH fee model. [ref: DEC-13]
  - **REQ-6.5**: Show a P5 / median / P95 range for a batch of N via simulation; P5 (worst case) is visually prominent. [ref: DEC-10]
  - **REQ-6.6**: Show time per unit as cast time x runs per unit plus a configurable per-action overhead, and time per batch including a configurable per-batch overhead; show gold/hour for the batch. [ref: DEC-12]
  - **REQ-6.7** (MAY): Show leftover items from a simulated batch. [ref: DEC-11]
  - **REQ-6.8** (SHOULD): A step can disenchant any item of a quality, armor vs weapon and item level band. Its item is not priced; instead the workflow shows the most to pay per item: break-even, safe (worst case breaks even) and for a target gold per hour. [ref: DEC-20]
- **REQ-7** (MUST): AH flip watchlist with a calculator per item. Flips themselves are not tracked yet (ledger, #16). [ref: DEC-13, DEC-24]
  - **REQ-7.1**: Inputs: buy and expected sell price per item, quantity, listing duration, faction or neutral AH, and the item (its vendor sell price sets the deposit, its class sets whether the quantity is posted as one lot or per piece, REQ-5.3).
  - **REQ-7.2**: Outputs: profit per item and for the whole quantity if it sells on the first listing, cost per failed listing (the deposit for posting the quantity once), and the number of relists until the flip breaks even.
  - **REQ-7.3**: Settings are remembered per item: buy price, sell price, quantity, duration and AH type. Starred items are favorites.
  - **REQ-7.4**: One sortable watchlist table instead of a single form: favorites plus every item a workflow buys or sells on the AH. Columns: last seen low (and when), typical price with the number of snapshots n, buy below, sell at (the saved sell price, else the typical price), margin per item and % of cost when buying at the last low, and relists until break-even. Clicking a row opens the calculator inline.
  - **REQ-7.5**: "Buy below" is the most to pay per item for a target margin on cost (a setting, default 15%) after the AH cut, any deposit spent on sale, and one lost deposit. A last seen low at or under it is highlighted.
  - **REQ-7.6**: Record AH prices from an expanded row: the lowest price (required), its quantity and the available count from the search result, and optionally more rows typed as `450x58c 900x61c`. Each save is a manual price snapshot (DEC-23) for the row's AH type. The row shows last low, min, typical and n, a chart of the lowest price over time against the typical price and "buy below", and the recent snapshots with delete.

## Non-functional requirements
- **NFR-1** (MUST): Single-user personal tool.
- **NFR-2** (MUST): Money handled as integer copper; displayed as gold/silver/copper.
- **NFR-3** (MUST): All Wowhead access isolated in one adapter module that maps responses to the tool's own item/recipe shape, so a Wowhead change is a one-file fix. [ref: DEC-4]
- **NFR-4** (MUST): Polite Wowhead usage: cached, on-demand requests only, no crawling. [ref: DEC-5]
- **NFR-5** (MUST): Game rules that may change (AH cut, deposit rates, durations, overhead defaults) live in configuration.
- **NFR-6** (SHOULD): Works offline from cache once data is imported.

## Success criteria
- The DE shuffle is modelled end to end from pasted Wowhead links plus manual vendor prices and one DE rule, and shows profit/unit, time/unit, gold/hour and P5/median/P95 for a batch of 20.
- A new recipe can be added and used in a workflow without code changes.
- Flip calculator results match a hand calculation for the configured fee rates.
- Changing a price updates all workflow results immediately.

## Open questions
- What is the "unit" of a workflow for per-unit figures: the first step's product, a user-chosen item (e.g. per glove), or per run of the first step?
- Created quantity parsing: tooltips show "(2)" after some created items (gloves, wand, and the white Bolt of Linen Cloth) but not others (oil). It is not a quality marker, and its meaning is unknown. Test a recipe that genuinely creates several items before trusting any quantity parsed from tooltips; until then default to 1 and allow manual override.
- Forever AH fee values (cut per AH type, deposit rates, available durations) need verifying in beta/launch.
- DE rule values for the relevant brackets: seed from Classic knowledge and validate against DE Tracker totals, or wait for Wowhead data?
- Default batch size N and default per-action / per-batch overheads.
