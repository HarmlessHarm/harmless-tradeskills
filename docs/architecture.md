# Architecture: WoW Forever Profession Toolbox (MVP)

## Stack
React + Vite, deployed on Vercel. Storage is SQLite (sql.js, WASM) in the browser, persisted to IndexedDB [ref: DEC-18]. Shareable game data (items, recipes, DE rules), shareable AH price snapshots (every AH price in the app), and personal data (workflows, flip favorites and ledger, min AH prices, characters, settings) are separate database files [ref: DEC-21, DEC-23, DEC-27]. Wowhead is proxied through a Vercel rewrite at `/wh/{item|spell}/{id}`.

## Data model (conceptual)
- **Item**: WoW item ID, name, quality, item level, class (armor/weapon/reagent...), vendor sell price (imported), vendor buy price (manual), source and timestamps, manual overrides. [ref: DEC-3, DEC-6, REQ-1]
- **Recipe**: spell ID (or local ID for manual recipes), kind (craft, disenchant, convert, ...), profession/skill optional, inputs (item + qty), tools (items required, not consumed), outputs (item, chance, min qty, max qty), cast time. [ref: DEC-1, REQ-2]
- **DisenchantRule**: quality, item level min/max, item class (armor/weapon) -> outputs (item, chance, min/max qty). A DE recipe for an item is derived from the matching rule rather than stored. [ref: DEC-2, REQ-3]
- **PriceObservation**: item, channel (AH), price, optional min AH price, timestamp. [ref: REQ-4]
- **Workflow**: name, notes, ordered recipe references, buy map (item -> AH/vendor) for external inputs, sell map (item -> AH/vendor/keep) for terminal outputs. Recipes are referenced, not copied. [ref: DEC-9, REQ-6]
- **Recipe learning** (on Recipe): learned from (trainer/vendor/drop/quest/other), required skill, skill-up levels (orange/yellow/green/grey, orange optional). [ref: DEC-29]
- **Character** (personal): name, realm, faction, level, notes, professions with skill, and recipes learned by hand. A character knows trainer recipes its skill allows plus the ones marked learned. [ref: DEC-29]
- **Config**: AH cut per AH type, deposit rate per duration, durations, per-action overhead, per-batch overhead, default batch size. [ref: REQ-5, NFR-5]

## Engine (conceptual)
- **Price resolver**: single entry point `price(item, channel)`; later home of reputation and other modifiers. [ref: DEC-8, REQ-4.3]
- **AH sell channel**: applies cut and deposit; shared by workflows and the flip calculator. [ref: DEC-13, REQ-5]
- **Workflow evaluator**: links steps, solves runs per unit, computes EV profit and time, and runs a Monte Carlo batch simulation for percentiles. No recursion or search in the MVP. [ref: DEC-9, DEC-10, DEC-12, REQ-6]
- **Future optimizer** (not MVP): recursive cost-to-make / best-use over the same graph; needs a cycle guard because conversions can go both ways.

## Integration points
- **Wowhead tooltip endpoint** (verified working for Forever with plain HTTP):
  - `https://nether.wowhead.com/forever/tooltip/item/{id}` -> JSON `{name, quality, icon, tooltip}`; tooltip HTML contains item level, slot, armor/weapon type, "Sell Price" in copper.
  - `https://nether.wowhead.com/forever/tooltip/spell/{id}` -> JSON with tooltip HTML containing cast time ("5.125 sec cast") in the first table, then `Reagents:<br /><div class="indent q1">` with item links followed by `&nbsp;(n)` quantities, then the created item link followed by its own tooltip. `Tools:` link to an item search rather than an item ID and are ignored (the crafter is assumed to have them). Real responses are saved in `src/wowhead/fixtures/`.
  - Unofficial and undocumented (used by Wowhead's own tooltip script). Full pages at `www.wowhead.com/forever/...` return a bot check to plain HTTP, so vendor buy prices, DE tables and "created by" lookups are not available this way. [ref: DEC-4, DEC-7]
  - Accept pasted URLs like `https://www.wowhead.com/forever/spell=3840/heavy-linen-gloves` and extract type + ID.
- **Known IDs for the DE shuffle**: Heavy Linen Gloves item 4307 / spell 3840; Bolt of Linen Cloth item 2996 / spell 2963; Linen Cloth 2589; Coarse Thread 2320; Disenchant spell 13262; Greater Magic Wand spell 14807; Minor Wizard Oil spell 25124.
- **Future**: DE Tracker fork SavedVariables (`DET_Log`) import via a Lua table parser [ref: DEC-17]; possibly ahledger.com as a Forever price source (unverified).

## Open architecture questions
- Stack and runtime: web app, desktop, or local script with a UI? Where does it run?
- Storage: JSON/YAML files in the repo vs SQLite vs something else. Manual edits to recipes and DE rules should stay easy.
- Tooltip HTML parsing approach and how to handle parse failures (show raw tooltip and fall back to manual entry?).
- Simulation size and performance budget (runs per evaluation) so re-pricing feels instant.
