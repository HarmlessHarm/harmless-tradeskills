# Handoff: WoW Forever Profession Toolbox

- **Target**: new-project
- **PRD maturity**: developing
- **Branches present**: architecture
- **Framework hint**: detect from repo
- **Repo creation requested**: no

## Source context
A brainstorm for a personal WoW Forever profession calculator, starting from a disenchanting example (the "DE shuffle") and growing into a generic recipe graph with saved workflows and an AH flip calculator. Data sourcing was investigated: Wowhead's Forever tooltip endpoint was verified for items and recipes; vendor buy prices and DE rules stay manual for the MVP. The chat ended with MVP scope agreed and a request to hand off to code.

## Open questions / assumptions to verify
- **No stack chosen.** Pick one before scaffolding; the chat never discussed framework, runtime or storage.
- **Unofficial data source.** The Wowhead tooltip endpoint is undocumented; check Wowhead's terms, cache aggressively and keep all access in one adapter.
- **Beta data may change at launch (4 Nov 2026).** Do not hardcode values seen in beta; anything imported should be refreshable.
- **Tooltip "(2)" quirk.** Treat created quantity as 1 unless verified; do not parse the "(2)" after green items as quantity.
- **Workflow "unit" is undefined** (per glove? per first-step run?). Needed before per-unit numbers make sense.
- **AH fee rules for Forever** are unknown; ship with configurable placeholders and verify in game.
- **User writing preference**: no em dashes in any generated text, docs or UI copy.

## Files in this bundle
- idea.md
- decisions.md
- prd.md
- architecture.md
