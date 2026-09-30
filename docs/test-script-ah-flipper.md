# Test script: AH Flipper (#19)

Manual test script for the AH Flipper redesign: fee model, shareable prices database, watchlist,
price entry, ledger, price floor and summary, and AH prices for workflows and items. Run it on a
Vercel preview or `npm run build && npx vite preview`. Automated tests (`npm test`) cover the maths;
this script covers what a person sees and does.

Each case lists steps and the expected result. Mark each **Pass**, **Fail** (with what you saw) or
**Blocked**. Money is written as in the app: `1g 2s 3c`.

## 0. Setup

Use a fresh browser profile or a private window, so nothing from earlier sessions interferes.

| # | Step | Expected |
|---|---|---|
| 0.1 | Settings > Data > Danger zone > **Clear all data**, confirm. | "Cleared game data, AH prices and personal data." |
| 0.2 | Settings > General: leave every AH value at its default. | Faction cut 5%, 8 hours deposit 15%, minimum deposit 1c, deposit **Refunded**, armor/weapons **One auction per piece**, everything else **One auction per lot**, AH prices **Latest price**. |
| 0.3 | Items > "Add by hand": ID `990001`, name `Test Widget`, Add. | Item listed with no vendor sell price. |
| 0.4 | Workflows > **Import DE shuffle**. Wait for it to finish. | Workflow "DE shuffle" exists; Linen Cloth is bought on the AH. |

**Why the Test Widget:** it has no vendor sell price and its class is "other". So its deposit is
always the 1c minimum, and a quantity is posted as one auction. That makes every expected number
below exact. Unless a step says otherwise, the widget is on the faction AH with 8 hours, quantity 1,
and a 15% target margin.

## A. Settings: AH rules (step 1)

| # | Step | Expected |
|---|---|---|
| A1 | Open Settings > General. | Warning "Not checked yet…". Buttons **Mark as checked in game** and **Reset to defaults**. AH flip page shows "AH rules are not checked in game yet (Settings)". |
| A2 | Click **Mark as checked in game**. | Text changes to "Checked in game on <today>". The warning on the AH flip page disappears. Button reads "Checked again today". |
| A3 | Set "Everything else" to **One auction per piece**, then back to **One auction per lot**. | The choice sticks after a page reload. |
| A4 | Set Deposit on sale to **Kept by the AH**. Open a workflow that sells on the AH. | Workflow warning mentions deposits are not refunded and not included in profit. Set it back to **Refunded**. |
| A5 | Change the faction cut to 6, then **Reset to defaults**. | Cut back to 5; the "checked" date is cleared (warning returns). Mark as checked again if you like. |

## B. Data: three databases (step 2)

| # | Step | Expected |
|---|---|---|
| B1 | Settings > Data. | Three equal cards, centred in the panel: **Personal data** (person icon), **AH prices** (coins icon), **Game data** (book icon), each saying what it holds, with an **Export …** button (download icon) and **Import personal data** / **Add pricing data** (plus icon) / **Import game data** (upload icon). On a phone the cards stack, still centred. Danger zone: Clear game data / **Remove added prices** / **Clear AH prices** / Clear personal data / Clear all data. |
| B2 | After recording some prices (section E), **Export AH prices**. | A file `harmless-tradeskills-prices-<date>.sqlite` downloads. |
| B3 | **Clear AH prices**, confirm. | Watchlist price columns empty (n = 0); workflows lose their AH prices; min AH prices, ledger and favorites stay. |
| B4 | **Add pricing data** with the file from B2. | "Added N AH prices from …. Your own prices are unchanged." Prices are back **without** a "shared" badge (they are yours). Adding it a second time: "Added 0 … (N you already had)". |
| B4b | Get an AH prices export from **another player** (or another browser profile that recorded different prices) and **Add pricing data** with it. | Their new prices appear with a purple **shared** badge (hover: "Added from <file>"); any snapshot you already had keeps your version; your own prices are unchanged. |
| B4c | **Remove added prices**, confirm. | "Removed N added AH prices." Only the shared ones are gone; your own prices stay. |
| B4d | Use the wrong button: an AH prices file on **Import personal data**, and a personal data file on **Add pricing data**. | Refused straight away, without a "Replace…?" question: "This file holds AH prices, not personal data." / "This file holds personal data, not AH prices." Nothing changes. |
| B5 | *Upgrade path (if you have one):* import a **personal data export made before this change** (it has AH prices in the old format). | "Imported personal data". Its AH prices appear on the Items page and in workflows, with their old dates; its min AH prices appear in the Min AH price column. Importing the same old file again does not raise any item's n on the watchlist. |

## C. Watchlist table (step 3)

| # | Step | Expected |
|---|---|---|
| C1 | Open **AH flip**. | Summary strip on top (Watching, Stock at cost, Unrealized, Realized 30 days). Watchlist lists **Linen Cloth** with a **workflow** badge (the DE shuffle buys it on the AH). |
| C2 | Type `Test Widget` in "Add item to watch", press Enter. | Test Widget added as a favorite (filled star) and its row opens. |
| C3 | Hover the empty star on Linen Cloth. | It grows, brightens and shows filled. Moving away restores it. |
| C4 | Click Linen's star. | It becomes a favorite and stays listed. Click again: it unstars **at once** (a workflow keeps it on the list, so no fade). |
| C5 | Add `Wool Cloth` (or any item no workflow uses) and then click its filled star. | Row shows "Leaving the list. Click ☆ to keep it."; after about **1s** it starts fading, over **3s**; at about 4s it is gone. After a reload it is still gone. |
| C6 | Repeat C5 and click the star again during the fade. | The row comes back at full opacity, starred. |
| C7 | Repeat C5 and switch to another tab within a second. Come back. | The row is gone (leaving the page finishes the removal). |
| C8 | Filters **Favorites**, **In workflows**, **Holding** (after section F), search box. | Each shows only matching rows; search matches item names. |
| C9 | Click each column header twice. | Rows sort ascending then descending; empty values sort last. |
| C10 | Look at the header row. | Every numeric header ends exactly above its values; **n** is its own narrow column; header controls sit on one line. |
| C11 | Set Target margin to 20, then back to 15. | "Buy below" changes for every row, and comes back. |

## D. Calculator (step 3)

Record the two Test Widget prices from E1 and E2 first, so the typical price is **1s 20c** and the
last low is **1s**.

| # | Step | Expected |
|---|---|---|
| D1 | Look at the Test Widget row. | Last seen low **1s** (just now), Typical **1s 20c**, n **2** (amber), Buy below **98c**, Sell at **1s 20c** "typical", Margin **14c** "14%", Relists **14**. Last low is not green (1s is above 98c). |
| D2 | Open the row. In "I see it at" type `90c`, Enter. | Green **BUY** "8c under 'buy below'". Profit per item **24c**, Most to pay for a 15% margin **98c**, AH cut per item **6c**, Deposit "8 hours, one auction" **1c** "(vendor price unknown: minimum)", Relists **24**, Break-even sell price **94c**. |
| D3 | Type `1s 5c` in "I see it at". | Red **TOO HIGH** "7c over 'buy below'". |
| D4 | Set Quantity to 20 (with 90c). | Profit "24c (4s 80c for 20)"; Deposit "one auction of 20" still **1c**; "Times the lot can expire before it stops paying" **480**. |
| D5 | Switch Neutral / Faction and 2 / 8 / 24 hours; reload the page; reopen the row. | Every input (buy, sell, quantity, AH, duration) is remembered for this item. Set back to Faction, 8 hours, quantity 1, clear "I see it at". |
| D6 | Type a Sell at of `2s`. | Sell at column shows 2s (no "typical" label); clearing it goes back to the typical price. |

## E. Recording prices (step 4)

All on the Test Widget row, AH prices card.

| # | Step | Expected |
|---|---|---|
| E1 | Lowest `1s 20c`, Qty at it `2`, Available `5`, More rows `450x120 400x260`. Do not save yet. | "Read as: 2 @ 1s 20c · 450 @ 1s 20c · 400 @ 2s 60c" and a warning "The rows hold 852 units but Available says 5: using 852." Hint: "Market value 1s 20c (solid: the average of the cheapest 15–30% of 852 units; pricier rows do not count)". |
| E1b | Change Available to `2000`. | The warning disappears; market value still 1s 20c, solid, "of 2000 units". Click **Save**. |
| E2 | Lowest `1s`, nothing else. Save. | The fields clear. Stats: Last low **1s**, Min **1s**, Typical **1s 20c**, n **2** (amber). The list shows both, newest first; the 1s one says "partial". |
| E3 | More rows `450x58c junk`. | Red "Not a row: 'junk'. Rows are quantity x price, like 450x58c." **Save** is disabled. |
| E4 | More rows `20 x 1g 5s, 3@2g`. | Read as "…20 @ 1g 5s · 3 @ 2g" (no error). Clear the field without saving. |
| E5 | Hover (or Tab to) each dot in the chart. | A tooltip shows price, date and market value with "solid"/"partial". Filled dot = solid, hollow dot = partial. Lines "typical 1s 20c" and "buy below 98c" are labelled at the right and not cut off. |
| E6 | Switch the row to **Neutral**. | Card title "AH prices (neutral)", no prices yet (n 0). Switch back to Faction. |
| E7 | Delete the 1s snapshot (× in the list), confirm. | n drops to 1, last low becomes 1s 20c. Re-record `1s` so later numbers hold. |

## F. Ledger (step 5)

Test Widget row, Ledger card, **Average cost** selected. These are the examples from #19.

| # | Step | Expected |
|---|---|---|
| F1 | Buy, Qty `10`, Paid each `5s`, **Log**. Then Buy `20` @ `6s`. | Holding **30**, Avg cost **5s 67c**, Realized "-". |
| F2 | Sell, Qty `15`, Sold each `8s`, Log. | Holding **15**, Avg cost **5s 67c**, Realized **29s** (1g 20s − 6s cut − 85s cost). The Sell row in the list shows profit **29s**. |
| F3 | Switch to **FIFO**. | "Cost each (FIFO)" **6s**, Realized **34s** (cost 80s). Switch back to Average cost. |
| F4 | Unrealized tile. | **−67s 90c** (15 × 1s 14c after cut − 85s). FIFO shows −72s 90c. |
| F5 | Adjust, Qty `-5`, Log. | Holding **10**, Avg cost still **5s 67c**, Realized unchanged (removed stock is not profit). Delete that adjustment: Holding back to 15. |
| F6 | Sell `20` @ `8s`, Log. | Warning "5 sold units were never logged as bought: they count at zero cost…". Delete that sell. |
| F7 | In the calculator, "I see it at" `90c`, click **Log buy: 1 @ 90c**. | Button briefly says "Logged"; Holding 16. Delete that buy. |
| F8 | Watchlist Holding column for the widget. | "15 @ 5s 67c". The **Holding** filter shows it. Unstarring the widget does not remove it (you hold stock); star it again. |
| F9 | Reload the page. | All transactions and numbers persist. |

## G. Price floor and summary (step 6)

With F2's state (15 held @ 5s 67c, typical 1s 20c).

| # | Step | Expected |
|---|---|---|
| G1 | Ledger card. | Floor tile **5s 97c** (warning colour). Warning: "Selling at 1s 20c does not cover your floor of 5s 97c: the market is under what you paid…". |
| G2 | Calculator. | Last line "Floor for the 15 you hold: 5s 97c (sell at is under it)". |
| G3 | Watchlist Holding cell. | Badge **below floor**, with a tooltip that explains it. |
| G4 | Summary strip. | Watching "N items / 1 held", Stock at cost **85s** "1 below floor", Unrealized **−67s 90c**, Realized 30 days **29s**, all time 29s. |
| G5 | Set the widget's Sell at to `7s`. | Badge and warnings disappear (7s ≥ 5s 97c). Clear Sell at again. |

## H. AH prices for workflows and items (step 7)

| # | Step | Expected |
|---|---|---|
| H1 | Items page, **AH price (faction)** for Test Widget. | Shows **1s** (latest snapshot, Latest rule); Price age "just now". |
| H2 | Type `30c` in that cell, Enter. | Cell shows 30c; on AH flip the widget's n went up by 1 and last low is 30c. |
| H3 | Settings > General > AH prices > **Typical price**. Back to Items. | Widget's AH price shows its typical price (not 30c). Switch back to **Latest price**: 30c again. |
| H4 | DE shuffle: set **Minor Wizard Oil** to sell on **AH**; in its price cells type AH price `10s`, note the **Worst case** figure, then type min AH price `8s`. | The oil's AH price shows 10s ("just now"). With the min AH price the Worst case figure drops (the median does not change): the worst case now assumes oil sells at 8s. On the Items page the oil shows AH price 10s and Min AH price 8s. Clear the min AH price: the Worst case returns to its earlier value. (Workflows without chance-based outputs show a separate "With min AH prices" figure instead.) |
| H5 | DE shuffle: set its AH to **Neutral** (workflow settings). | Linen's AH price cell is empty (no neutral price yet) and the workflow reports a missing AH price. Type `20c` there: the workflow uses it. On AH flip, Linen on Neutral shows that price. Set the workflow back to Faction. |
| H6 | A price cell: clear it and press Enter. | Nothing is recorded; the cell shows the current price again (prices are history; delete a wrong one from the flip price list). |

## I. Layout and accessibility

| # | Step | Expected |
|---|---|---|
| I1 | Narrow the window to about 390px (or use a phone). | No sideways page scroll. The table scrolls inside its panel. An open row stacks calculator, prices and ledger; stat tiles sit two per row; delete buttons visible. |
| I2 | Keyboard only: Tab through the watchlist header, a row's star, the calculator, the price form and chart dots. | Everything is reachable; focus is visible; a focused chart dot shows its tooltip. |
| I3 | Turn on "reduce motion" in the OS, repeat C5. | No grow or fade animation; the row still waits and then disappears. |
| I4 | Screen reader (optional): the AH prices rule in Settings. | Its options read as "Latest price" and "Typical price". |

## J. Regression

| # | Step | Expected |
|---|---|---|
| J1 | DE shuffle with its original prices. | Profit, time, gold/hour and the worst-case range show as before this change (with the same AH prices). |
| J2 | Items, Recipes, Disenchant rules pages. | Load and sort as before; iLvl/Cast/Min/Max iLvl headers now sit right-aligned over their numbers. |
| J3 | Browser console during the whole run. | No errors. |

## Still to check in game

The AH rules are placeholders until checked in WoW Forever (A1): the cut, deposit per duration,
minimum deposit, whether the deposit comes back on sale, and whether stackable items post as one
lot. Update them in Settings > General and click **Mark as checked in game**.
