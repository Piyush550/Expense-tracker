# Expense Tracker MCP: test results (local, Claude Code)

The tables after "After the fixes" record the **first run**, before the fixes.

Run on **21 October 2026** against branch `feature/shortcut-pick-people` at `c15960f`. The guide is [MCP_TEST_PROMPTS.md](MCP_TEST_PROMPTS.md).

- **Client:** Claude Code 2.1.295, headless, connected only to `http://localhost:5173/mcp/<key>` (`npm run dev:local`, local database and Auth emulator).
- **Fixtures:** each case had its own fresh space built to §3's fixtures (Test, Asha Rao, Bala Iyer, Chen Li; Boys, Home and Solo groups; a trip; an empty space; a seeded read flat; 51- and 201-row months). Separate keys for Test, Bala, Chen and an outsider.
- **Checks:** each case's tool calls, arguments and replies were recorded, then the space's stored expenses, payments and balances were read back and reviewed by hand. The space was removed afterwards.
- **Not covered here:** ChatGPT, Claude web and mobile, and the Netlify deployment. See "Not run".

## After the fixes (same day, follow-up commit)

Every server failure below was fixed in `server/mcp.ts`, each with a regression test in `tests/mcp.test.ts`. The audit and the affected Claude cases were then run again.

**Server audit after the fixes: 82 pass, 0 fail, 4 informational.** The 4 informational rows are:
- an unkeyed repeat saves twice (by design: no `request_id`, no deduplication);
- a future date is accepted;
- "28 December" with no year resolves to 2025;
- the percent weights are now shown in the list.

| Finding | Fix | Now |
|---|---|---|
| K06 silent rounding | More than 2 decimals (amount, exact share, percent) is refused with "ask which to use" | M04 and M04b: Claude asks; nothing saved |
| K04 reordered retry | The retry id hashes the resolved content with people sorted | Q02: one row |
| K01 split-only edit | New values keep the current split type | Percent 70/30 kept |
| K07 optional version | `version` is required on `edit_expense` | No-version edit refused; app edit intact |
| E14 empty edit | No fields means no write | Version unchanged |
| K02 empty group or `[]` | Refused, with what to do | No row |
| K03 name clashes | A person and a group with the same name, two groups with one name, or a group called "Everyone" are refused with both choices; `group:Name` and `person:Name` pick explicitly | G05, G06: Claude uses `group:`; G09: Claude asks |
| K05 post-write failure | A failed balance read only drops the balance line; the write is reported as saved | Success reply |
| K08, K09, K11 listing | `list_expenses` gains `offset` and the `paid_by`, `involving` (with that person's share total) and `search` filters. Counts and totals come from the database's month summary | 5,001 rows count as 5,001 / ₹5,001. R05, R06, R08: Claude uses the filters |
| K10 payment history | New read-only `list_payments` tool (month and person filters, dates, notes) | S02, P10, V05/V06 read payments directly |
| "Split with X" reading | The tool description and server instructions say only the named people share, and the payer and "me" are added only when named | G02, G04, A07: the named group or person only |
| R12 weights | Percent and share weights are shown next to each share | "Chen Li ₹0.01 (99%), Test ₹0 (1%)" |

**Claude re-run (21 cases): all pass.**
- The 7 earlier failures now pass. C08, the client-only failure, also passed: Claude no longer claimed to have searched files.
- E05, E14 and G05–G09 still pass, and no longer rely on Claude working around the server.
- V01–06's stored ledger matches §5 exactly.
- In the first re-run, V04 paused to confirm the future 3 November date before recording. That's cautious model behaviour, not a server error. A second run recorded it with a warning.

## Second review (same day)

A further review found five more gaps. All are fixed, with regression tests in `tests/mcp.test.ts`:

| Gap | Fix |
|---|---|
| With 5,001 expenses, offset 5,000 returned nothing: paging ran over a list the API capped at 5,000 | New `/spaces/:id/expenses/page` route: filters, paging, count, total and the `involving` share all run in the database. Offset 5,000 now returns the 5,001st row |
| `list_payments` with 5,001 payments reported 5,000 / ₹5,000 and returned about 500,000 characters | New `/spaces/:id/settlements/page` route: exact count and total, pages of 50 by default (`limit` up to 200, `offset`), and a "Showing … of …" line |
| Filtering history by someone who had left gave "No person called Bala" | Read filters (`paid_by`, `involving`, `person`) also match former members. New expenses and payments still take only current members |
| A percent split with `split_between: ["me"]` but values for me and Chen saved both | When both are given they must name the same people; otherwise the call is refused with an explanation |
| The smoke runner required exactly 8 tools, but the server now has 9 | It checks the required tool names, and that no delete tool exists, instead of a count |

`%` and `_` in a search are matched literally.

## Summary

| Part | Result |
|---|---|
| Claude prompt cases (§5, §7–§14) | **119 of 126 pass**; 7 fail: 3 server bugs, 4 client interpretations |
| Original 16-prompt smoke suite (§6) | 16 of 16 pass (earlier run on the same commit) |
| Server audit: known failures, §15 schema checks, §16 transport checks | 66 pass, **14 fail**, 7 informational |
| ChatGPT; Claude web and mobile; Netlify rate limit and cold start | **Not run.** Needs this branch deployed (and ChatGPT access) |

**Bottom line:**
- Every known failure the guide lists reproduces on the server: K01–K07, K09, and E14's empty-edit write.
- With Claude, most of them are hidden because Claude reads the space first and sends complete arguments. Only K04 (reordered retry) and K06 (silent rounding) caused wrong stored data in natural-language use.
- Claude's own errors cluster on one phrasing: "split with X". Claude adds the payer or "me", while the guide expects only X.

## Server audit (direct MCP calls, fresh in-memory databases)

| Check | Expected | Observed | Result |
|---|---|---|---|
| K01 / E05 | percent kept, ₹70/₹30 |  type=equal shares={"Test":50,"Chen Li":50} | FAIL |
| E13 percent: total only | type and weights kept, shares scale | Masked by K01 (the expense had already become equal). Re-tested via Claude (E13a): percent kept, ₹600/₹400. | INFO |
| E13 shares: total only | shares kept, ₹800/₹400 |  {"Test":800,"Asha Rao":400} | PASS |
| K02 / G07 empty group | error, no row | saved for {"Test":50,"Asha Rao":50} | FAIL |
| K02 / G08 explicit [] | error or ask, no row | saved for {"Test":50,"Asha Rao":50} | FAIL |
| K03 / G05 group named Bala | group (Test+Chen) or ask | {"Bala Iyer":100} | FAIL |
| K03 / G06 group named Everyone | group (Bala+Chen) or ask | {"Test":25,"Chen Li":25,"Asha Rao":25,"Bala Iyer":25} | FAIL |
| K03 / G09 duplicate group names | ask which group, no row | saved for {"Test":50,"Asha Rao":50} | FAIL |
| Q01 identical retry | 1 row | 1 row(s) | PASS |
| K04 / Q02 reordered retry | still 1 row | 2 row(s) | FAIL |
| Q04 reused id, new content | new row, Tea not returned | 3 rows | PASS |
| Q03 unkeyed repeat | 2 rows (documented: no exactly-once) | 2 rows | INFO |
| K05 / Q06 add, balance read fails | success reply since it saved | reply ERROR: Injected failure · rows=1 | FAIL |
| K05 payment, balance read fails | success reply since it saved | reply ERROR · payments=1 | FAIL |
| K06 / M04 ₹1.005 | rejected, no row | saved ₹1 | FAIL |
| K06 / M04 exact 0.504/0.496 | rejected, no row | saved {"Test":0.5,"Bala Iyer":0.5} | FAIL |
| E09 stale version | refused | Someone changed this expense since (now version 2). Look at it again first. | PASS |
| K07 / E09 no version | refused or version required | accepted → "No version" v3 | FAIL |
| E14 empty edit | no write, version unchanged | ok v3→v4 | FAIL |
| K09 / R09 5,001 rows | count 5,001, ₹5,001 | 5000 expenses in Audit Flat 8, October 2026, ₹5,000 in all. Showing the newest 200; ask for a month or a higher limit to see others. | FAIL |
| K08 limit 201 | schema error | MCP error -32602: Input validation error: Invalid arguments for tool list_expenses: Too big: expecte | PASS |
| K08/K11 list_expenses params | offset/filters? | space, month, limit | INFO |
| K10 tool catalog | 8 tools, no payments history/group mgmt | list_spaces, get_space, list_expenses, get_balances, add_expense, add_expenses, edit_expense, record_payment | INFO |
| M01 ₹1,234.56 / 4 | ₹308.64 each | {"Test":308.64,"Chen Li":308.64,"Asha Rao":308.64,"Bala Iyer":308.64} | PASS |
| M02 ₹100 / 3 | sum exactly ₹100 | {"Test":33.34,"Chen Li":33.33,"Bala Iyer":33.33} | PASS |
| M03 ₹0.01 / 4 | sum 1 paisa | {"Asha Rao":0.01} | PASS |
| M07 1.5 shares | rejected | Shares must be whole numbers, like 1 or 2. | PASS |
| M08 percent 60+30 | rejected, no row | The percentages add up to 90%, not 100%. | PASS |
| M08 percent 120/-20 | rejected, no row | MCP error -32602: Input validation error: Invalid arguments for tool add_expense: Too small: expecte | PASS |
| M08 percent 0+0 | rejected, no row | The percentages add up to 0%, not 100%. | PASS |
| M08 duplicate entries | rejected | Someone is listed twice in the split. | PASS |
| M09 zero | rejected | MCP error -32602: Input validation error: Invalid arguments for tool add_expense: Too small: expecte | PASS |
| M09 negative | rejected | MCP error -32602: Input validation error: Invalid arguments for tool add_expense: Too small: expecte | PASS |
| M09 over limit | rejected | The amount is too large. | PASS |
| M09 ₹10 crore exactly | accepted | Added to Audit Flat 9: 2026-10-21 · M09 max · ₹10,00,00,000 · paid by Test (you) | PASS |
| G03 union Boys+Home+Bala | 4 people ₹30 each | {"Test":30,"Chen Li":30,"Asha Rao":30,"Bala Iyer":30} | PASS |
| G04 Solo | Chen ₹90 only | {"Chen Li":90} | PASS |
| D04/D03 31 Feb | rejected | Could not read the date "31 February 2026". Use 2026-10-21, 21 Oct, today or yes | PASS |
| D04/D03 29 Feb 2028 | accepted | saved 2028-02-29 | PASS |
| D04/D03 29 Feb 2026 | rejected | Could not read the date "29 February 2026". Use 2026-10-21, 21 Oct, today or yes | PASS |
| D04/D03 01/02/2026 | accepted | saved 2026-02-01 | PASS |
| D05 month "October" | read | 6 expenses in Audit Flat 9, October 2026, ₹10,00,01,544.57 in all. | PASS |
| D05 month "October 2025" | read | No expenses in Audit Flat 9, October 2025. | PASS |
| D05 month "Octember" | rejected | Could not read the month "Octember". Use 2026-10, October, this month or last month. | PASS |
| D05 month "last month" | read | No expenses in Audit Flat 9, September 2026. | PASS |
| D07 future date | accepted (documented) | saved 2030-01-01 | INFO |
| D08 28 Dec no year | inspect year | saved 2025-12-28 | INFO |
| P06 pay myself | rejected | Someone cannot pay themselves. | PASS |
| P06 pay Zed | rejected | No person called "Zed" in Audit Flat 9. Choose from: "Asha Rao", "Bala Iyer", "Chen Li", " | PASS |
| P03 no month → paid month | period 2026-11 | Recorded: Test (you) paid Bala Iyer ₹100 on 2026-11-03 (for November 2026) in Audit Flat 9. id 67926ec6-a9c8-41d1-a3cb-1589f918ddbe | PASS |
| B06 bad row 2 rolls back row 1 | 0 new rows | Row 2: The amounts add up to ₹80, not ₹100. | PASS |
| B09 two identical teas | 2 rows | Added 2 expenses (₹100) to Audit Flat 9: | PASS |
| G10 old expense after group change | still Bala+Chen | {"Chen Li":50,"Bala Iyer":50} | PASS |
| E04 exact: total only | rejected, unchanged | The amounts add up to ₹1,000, not ₹1,200. | PASS |
| R12 original weights in list | weights shown? | - 2026-10-21 · R12 · ₹0.01 · paid by Test (you) · split by percent: Test (you) ₹0, Chen Li ₹0.01 · id 1f0f7f04-bef9-4468-b4db-1daebc7264b2 (version 1) | INFO |
| C09 two spaces named Twin | ask which, no write | "Twin" could be "Twin" or "Twin" in your spaces. Use the full name. | PASS |
| C10 non-owner Bala adds | allowed, Bala payer | Added to Audit Flat 10: 2026-10-21 · Bala tea · ₹60 · paid by Bala Iyer (you) · split equally: Bala  | PASS |
| C11 removed member's key | no access | No space called "Audit Flat 10" in your spaces. Choose from: "Audit Flat 1", "Audit Flat 3", "Audit Flat 4", "Audit Flat 5", "Audit Flat 6", "Audit Flat 7", "Audit Flat 8", "Audit Flat 9". | PASS |
| C03 outsider by space id | no data | You aren't in any space yet. Create one in the app first. | PASS |
| C03 outsider list_spaces | none of ours | Signed in as Olu Out. You aren't in any space yet. | PASS |
| §15 missing description | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool add_expense: Invalid input: expected stri | PASS |
| §15 amount as string | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool add_expense: Invalid input: expected numb | PASS |
| §15 non-UUID request_id | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool add_expense: Invalid UUID at request_id | PASS |
| §15 non-UUID expense_id | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool edit_expense: Invalid UUID at expense_id | PASS |
| §15 version 0 | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool edit_expense: Too small: expected number  | PASS |
| §15 limit 0 | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool list_expenses: Too small: expected number | PASS |
| §15 unknown split type | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool add_expense: Invalid option: expected one | PASS |
| §15 bulk 0 rows | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool add_expenses: Too small: expected array t | PASS |
| §15 bulk 51 rows | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool add_expenses: Too big: expected array to  | PASS |
| §15 description 101 chars | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool add_expense: Too big: expected string to  | PASS |
| §15 notes 501 chars | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool add_expense: Too big: expected string to  | PASS |
| §15 payment note 201 chars | error, no write | MCP error -32602: Input validation error: Invalid arguments for tool record_payment: Too big: expected string  | PASS |
| §15 unknown tool | error, no write | MCP error -32602: Tool delete_expense not found | PASS |
| §15 none of the above wrote | 0 rows | 0 rows | PASS |
| §16 50-row batch over 64 KiB API limit | readable error, nothing saved | Not reachable: four-person rows stay under the 64 KiB API limit even at maximum field lengths. Added 50 expenses (₹50) to Audit Flat 11: - 2026-10-21 · Row | INFO |
| §16 header auth catalog | 8 tools |  | PASS |
| §16 GET/DELETE | 405 + Allow | 405/405 allow=POST, OPTIONS | PASS |
| §16 CORS preflight | allows auth + protocol headers | 204 authorization,content-type,accept,mcp-protocol-version,mcp-session-id,last-event-id | PASS |
| §16 no-store | Cache-Control: no-store | no-store | PASS |
| §16 invalid JSON | JSON-RPC parse error, no stack | 400, JSON-RPC −32700 "Parse error" with the parser message only (no stack trace) | PASS |
| §16 unknown method | method not found | 200 | PASS |
| §16 >256 KiB | 413 | 413 | PASS |
| §16 URL key vs header key | header wins (Test) | {"result":{"content":[{"type":"text","text":"Signed in as Test (test@example.com).\n- Audit Flat 1 (monthly, 4 people, y | PASS |
| §16 Firebase token as MCP key | 401 |  | PASS |
| §16 expired key | 401 |  | PASS |
| S10 key: merge / key management | 403 token_scope | 403/403 | PASS |
| S10/K12 key can call non-catalog API routes | documented: broader than 8 tools | POST /groups with key → 404 (not 403) | INFO |

## Claude cases

✗ after a tool name means that call returned an error, which was usually the intended refusal.

| Case | Result | Tool calls per turn | Stored | Notes |
|---|---|---|---|---|
| V01-06 | PASS | get_space, add_expense → get_space, add_expense → get_space, add_expense → record_payment → list_expenses, get_balances → get_balances, list_expenses, get_space, get_balances, list_expenses | 3 exp, 1 pay | Stored state matches §5 exactly: Test +₹500, Asha −₹150, Bala −₹350, Chen ₹0, payment period 2026-10. It had to infer the payment from balances because there is no payment-history tool (K10). |
| C01 | PASS | list_spaces | 0 exp, 0 pay |  |
| C02 | PASS | get_space, get_balances | 0 exp, 0 pay |  |
| C03 | PASS | get_space✗, list_expenses✗, list_spaces | 7 exp, 1 pay |  |
| C04 | PASS | list_spaces → [app: revoke key in app] → (no tool) | 0 exp, 0 pay | After the revoke the tools vanished. It repeated the earlier list, labelled "may have changed", which is acceptable. |
| C05 | PASS | [app: regenerate key in app] → (no tool) → list_spaces | 0 exp, 0 pay |  |
| C06 | PASS | get_space → (no tool) | 0 exp, 0 pay |  |
| C08 | FAIL | (no tool) | 0 exp, 0 pay | **Client.** With the connector unreachable, it invented a balance search ("checked Spotlight, ~/Documents") although it had no tools. It didn't invent a balance. |
| C09 | PASS | add_expense✗, list_spaces, get_space, get_space | 0 exp, 0 pay |  |
| C10 | PASS | get_space, add_expense, record_payment | 1 exp, 1 pay | Bala's key: Bala was the payer and the payment Bala→Test ₹20 was recorded. It asked for the new name instead of guessing one. |
| C11 | PASS | get_space✗ | 0 exp, 0 pay |  |
| R01 | PASS | list_expenses, get_space | 0 exp, 0 pay |  |
| R02 | PASS | list_expenses | 7 exp, 1 pay |  |
| R03 | PASS | list_expenses, list_expenses | 7 exp, 1 pay |  |
| R04 | PASS | list_expenses | 7 exp, 1 pay |  |
| R05 | PASS | list_expenses | 7 exp, 1 pay |  |
| R06 | PASS | list_expenses, list_expenses | 7 exp, 1 pay |  |
| R07 | PASS | list_expenses, get_space | 51 exp, 0 pay |  |
| R08 | PASS | list_expenses, get_balances | 201 exp, 0 pay | Disclosed the 200-row limit, then proved completeness from the October balances. |
| R10 | PASS | list_expenses, list_expenses | 7 exp, 1 pay |  |
| R11 | PASS | list_expenses, get_balances, list_spaces, list_expenses✗, list_expenses | 1 exp, 0 pay | The other spaces changing mid-answer is an artifact of the parallel test run. |
| R12 | PASS | list_expenses | 1 exp, 0 pay |  |
| R13 | PASS | list_spaces, get_balances, get_balances, get_balances✗, get_balances, get_balances, list_spaces, get_balances, get_balances, get_balances | 7 exp, 1 pay | The other spaces changing mid-answer is an artifact of the parallel test run. |
| A01 | PASS | add_expense | 1 exp, 0 pay |  |
| A02 | PASS | add_expense | 1 exp, 0 pay |  |
| A03 | PASS | add_expense | 1 exp, 0 pay |  |
| A04 | PASS | (no tool) → add_expense | 1 exp, 0 pay |  |
| A05 | PASS | (no tool) | 0 exp, 0 pay |  |
| A06 | PASS | list_spaces | 0 exp, 0 pay |  |
| A07 | FAIL | get_space → add_expense | 1 exp, 0 pay | **Client.** "I meant Chen" became me + Chen (₹50 each). Doc expects Chen only, ₹100. Same "split with X" reading as G04. |
| A08 | PASS | get_space | 0 exp, 0 pay |  |
| A09 | PASS | get_space, add_expense | 1 exp, 0 pay |  |
| A10 | PASS | (no tool) | 0 exp, 0 pay |  |
| A11-12 | PASS | add_expense → edit_expense | 1 exp, 0 pay |  |
| G01 | PASS | add_expense | 1 exp, 0 pay |  |
| G02 | FAIL | get_space, add_expense | 1 exp, 0 pay | **Client.** Added the payer (Chen) to "split with Boys", giving a 3-way split of ₹200. Doc expects Test/Bala ₹300. Claude explained its reading and offered to change it. |
| G03 | PASS | get_space, add_expense | 1 exp, 0 pay |  |
| G04 | FAIL | get_space, add_expense | 1 exp, 0 pay | **Client.** "Split with Solo" became me + Chen (₹45 each). Doc expects Chen ₹90. Disclosed. |
| G05 | PASS | get_space | 0 exp, 0 pay | Claude asked, after reading get_space. K03 is still a server bug. |
| G06 | PASS | get_space | 0 exp, 0 pay | Claude asked. K03 is still a server bug. |
| G07 | PASS | get_space | 0 exp, 0 pay | Claude caught the empty group. K02 is still a server bug. |
| G08 | PASS | (no tool) | 0 exp, 0 pay | Claude refused an empty selection. K02 is still a server bug. |
| G09 | PASS | get_space | 0 exp, 0 pay | Claude caught the duplicate group names. K03 is still a server bug. |
| G10 | PASS | get_space, add_expense → [app: Boys changed to Asha in app] → add_expense, get_space, list_expenses | 2 exp, 0 pay |  |
| M01 | PASS | get_space, add_expense | 1 exp, 0 pay |  |
| M02 | PASS | get_space | 0 exp, 0 pay |  |
| M03 | PASS | get_space | 0 exp, 0 pay |  |
| M04 | FAIL | add_expense | 1 exp, 0 pay | **Server K06.** Saved ₹1 despite "do not round". Claude disclosed it afterwards, but the write had already happened. |
| M04b | FAIL | add_expense, list_expenses | 1 exp, 0 pay | **Server K06.** Saved ₹0.50/₹0.50 despite "do not round". Disclosed afterwards. |
| M05 | PASS | add_expense | 1 exp, 0 pay |  |
| M06 | PASS | add_expense → (no tool) | 1 exp, 0 pay |  |
| M07 | PASS | add_expense → add_expense✗, add_expense | 2 exp, 0 pay | Turn 2: it auto-converted 1.5:1 shares to 3:2 instead of asking. The ratio was preserved and disclosed. |
| M08 | PASS | get_space | 0 exp, 0 pay |  |
| M09a | PASS | (no tool) | 0 exp, 0 pay |  |
| M09b | PASS | get_space | 0 exp, 0 pay |  |
| M09c | PASS | get_space, add_expense✗ | 0 exp, 0 pay |  |
| M10a | PASS | list_spaces | 0 exp, 0 pay |  |
| M10b | PASS | add_expense | 1 exp, 0 pay |  |
| M10c | PASS | get_space | 0 exp, 0 pay |  |
| B01 | PASS | add_expenses | 2 exp, 0 pay |  |
| B02 | PASS | get_space, add_expenses | 3 exp, 0 pay |  |
| B03 | PASS | add_expenses | 2 exp, 0 pay |  |
| B04 | PASS | (no tool) | 0 exp, 0 pay |  |
| B05 | PASS | get_space | 0 exp, 0 pay |  |
| B06-11 | PASS | get_space → add_expenses | 2 exp, 0 pay |  |
| B07 | PASS | add_expenses → (no tool) | 50 exp, 0 pay |  |
| B08 | PASS | list_spaces | 0 exp, 0 pay |  |
| B09 | PASS | add_expenses | 2 exp, 0 pay |  |
| B10 | PASS | get_space → add_expenses | 3 exp, 0 pay |  |
| E01 | PASS | list_expenses, edit_expense | 1 exp, 0 pay |  |
| E02 | PASS | list_expenses | 2 exp, 0 pay |  |
| E03 | PASS | list_expenses, edit_expense | 1 exp, 0 pay |  |
| E04 | PASS | list_expenses | 1 exp, 0 pay |  |
| E05 | PASS | list_expenses, edit_expense | 1 exp, 0 pay | Passed only because Claude sent `split_type` itself. K01 is still a server bug. |
| E06 | PASS | get_space, list_expenses, edit_expense | 1 exp, 0 pay |  |
| E07 | PASS | list_expenses, edit_expense | 1 exp, 0 pay |  |
| E08 | PASS | list_expenses, edit_expense | 1 exp, 0 pay |  |
| E09 | PASS | list_expenses → [app: expense renamed in app] → edit_expense✗, list_expenses | 1 exp, 0 pay |  |
| E10 | PASS | list_expenses → [app: expense deleted in app] → edit_expense✗, list_expenses | 0 exp, 0 pay |  |
| E11 | PASS | list_expenses, edit_expense → get_space, add_expense✗ | 1 exp, 1 pay |  |
| E12 | PASS | list_expenses, edit_expense → edit_expense✗ | 1 exp, 0 pay |  |
| E13a | PASS | list_expenses, edit_expense | 1 exp, 0 pay |  |
| E13b | PASS | list_expenses, edit_expense | 1 exp, 0 pay |  |
| E14 | PASS | (no tool) | 1 exp, 0 pay | No edit call was made. A direct empty edit does bump the version (server audit). |
| P01 | PASS | record_payment, get_balances | 0 exp, 1 pay |  |
| P02 | PASS | record_payment | 0 exp, 1 pay |  |
| P03 | PASS | record_payment | 0 exp, 1 pay |  |
| P04 | PASS | get_balances | 1 exp, 0 pay |  |
| P05 | PASS | get_balances, get_space | 0 exp, 0 pay |  |
| P06 | PASS | get_space → (no tool) | 0 exp, 0 pay |  |
| P07 | PASS | list_expenses, get_balances, record_payment, get_balances | 1 exp, 1 pay |  |
| P08 | PASS | get_balances → [app: simplify debts turned off in app] → get_balances, get_space, get_balances | 2 exp, 0 pay |  |
| P09 | PASS | list_spaces, get_balances, get_balances | 1 exp, 0 pay |  |
| P10 | PASS | get_balances, list_expenses | 1 exp, 1 pay | It inferred the payment from balances because there is no payment-history tool (K10). |
| D01 | PASS | add_expense → add_expense | 2 exp, 0 pay |  |
| D02 | PASS | list_expenses, list_expenses, get_balances, get_balances | 7 exp, 1 pay |  |
| D03 | PASS | add_expense | 1 exp, 0 pay |  |
| D04 | PASS | (no tool) | 0 exp, 0 pay |  |
| D04b | PASS | add_expense | 1 exp, 0 pay |  |
| D05 | PASS | list_expenses, list_expenses, list_expenses✗ | 7 exp, 1 pay |  |
| D06 | PASS | list_expenses → add_expense | 2 exp, 0 pay |  |
| D07 | PASS | add_expense | 1 exp, 0 pay | Saved 22 Oct, but didn't call it future-dated in so many words. |
| D08 | PASS | get_space, add_expense | 1 exp, 0 pay |  |
| D09 | PASS | add_expense → get_balances, get_balances | 1 exp, 0 pay |  |
| D10 | PASS | list_expenses, list_expenses | 2 exp, 0 pay |  |
| Q01 | PASS | add_expense, add_expense | 1 exp, 0 pay |  |
| Q02 | FAIL | add_expense, add_expense | 2 exp, 0 pay | **Server K04.** Reordering the people with the same request ID saved a duplicate row. Claude spotted it and called it a bug. |
| Q03 | PASS | add_expense → (no tool) | 1 exp, 0 pay |  |
| Q04 | PASS | add_expense, add_expense | 2 exp, 0 pay |  |
| Q07 | PASS | add_expense → list_expenses, edit_expense | 1 exp, 0 pay |  |
| S01 | PASS | list_expenses | 1 exp, 0 pay |  |
| S02 | PASS | list_expenses, get_balances | 7 exp, 1 pay | Said payments can't be listed (K10), then inferred from balances. |
| S03 | PASS | list_expenses, get_balances | 0 exp, 1 pay |  |
| S04 | PASS | get_space | 0 exp, 0 pay |  |
| S05 | PASS | get_space | 0 exp, 0 pay |  |
| S06 | PASS | (no tool) | 0 exp, 0 pay |  |
| S07 | PASS | get_space, list_expenses | 0 exp, 0 pay |  |
| S08 | PASS | get_space | 0 exp, 0 pay |  |
| S09 | PASS | (no tool) → get_space, list_expenses | 0 exp, 0 pay |  |
| F01 | PASS | get_space → (no tool) | 0 exp, 0 pay |  |
| F02 | PASS | list_expenses | 1 exp, 0 pay |  |
| F03 | PASS | (no tool) | 0 exp, 0 pay |  |
| F06 | PASS | add_expense | 1 exp, 0 pay |  |
| F07 | PASS | get_space → (no tool) → add_expenses | 2 exp, 0 pay |  |
| F08 | PASS | (no tool) | 0 exp, 0 pay |  |
| F09 | PASS | add_expense | 1 exp, 0 pay |  |

## Not run

| Case | Why |
|---|---|
| All ChatGPT cases; Claude web and mobile; C07 | Need a deployed URL. Localhost can't be reached from those clients |
| F04, F05 (receipt images) | Headless Claude Code has no image upload. F03 was run with receipt text instead |
| Q05, Q08 | Need a group change or a timeout during an in-flight write. Q06 (post-write failure) is covered by the server audit (K05) |
| R09 (5,001 rows), S10, §15, §16 | Covered by the server audit above, not by prompts |
| §16 Netlify rate limit, cold start, log handling | Need the deployment |