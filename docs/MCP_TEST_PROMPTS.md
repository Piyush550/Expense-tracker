# Testing the MCP server with Claude

These prompts check that every tool is available and works when a real assistant uses it. You can paste them into Claude (claude.ai or the phone app, with the Expense Tracker connector on) or run them automatically with Claude Code.

## Test data

Use a throwaway space, because the prompts add expenses. Create a monthly space called **MCP Test Flat** with:
- **Asha Rao**, **Bala Iyer** and **Chen Li**, plus you;
- a group **Boys** containing Bala and Chen.

Locally (`npm run dev:local`) you can create the space in the app. Create a key under **Settings → iPhone & AI apps** and copy its connector address.

## Run them automatically (Claude Code)

```bash
MCP_URL="http://localhost:5173/mcp/et_…" node scripts/mcp-prompt-check.mjs
```

- Needs Claude Code installed and signed in (`claude` on PATH, or `CLAUDE_BIN=/path/to/claude`).
- Each prompt runs as a fresh conversation, connected only to this server.
- The script prints the tools Claude called, the arguments, and its answer, plus PASS/FAIL per prompt.
- It uses your Claude plan's usage (16 short conversations).

To use the server from Claude Code day to day:

```bash
claude mcp add --transport http expense-tracker "http://localhost:5173/mcp/et_…"
```

## The prompts, and what should happen

| # | Prompt | Expected |
|---|---|---|
| 1 | What Expense Tracker tools do you have? List their names only. | The 8 tools: `list_spaces`, `get_space`, `list_expenses`, `get_balances`, `add_expense`, `add_expenses`, `edit_expense`, `record_payment`. No delete tool |
| 2 | Which Expense Tracker spaces am I in, and where do I stand in each? | `list_spaces`; each space with its kind, how many people, and owed/owe/square |
| 3 | Who is in MCP Test Flat and what groups does it have? | `get_space`; 4 people, you marked owner; group Boys: Bala Iyer, Chen Li |
| 4 | Add ₹1,200 for groceries to MCP Test Flat. I paid; split it equally between everyone. | `add_expense`; ₹300 each for 4 people, dated today |
| 5 | In MCP Test Flat, Chen paid ₹600 for beer yesterday, split between the Boys group. | `add_expense` with `paid_by` Chen and `split_between` ["Boys"]; Bala and Chen ₹300 each; yesterday's date |
| 6 | Add a ₹500 cab to MCP Test Flat: I pay 60% and Chen pays 40%. | `add_expense`, `split_type` percent; you ₹300, Chen ₹200 |
| 7 | Add rent of ₹3,000 on 1 Oct to MCP Test Flat, split by shares: me 2 shares, Asha 1 share. | `add_expense`, `split_type` shares, date 1 October; you ₹2,000, Asha ₹1,000 |
| 8 | Add ₹1,000 electricity to MCP Test Flat: I owe ₹700 and Bala owes ₹300 exactly. | `add_expense`, `split_type` exact; you ₹700, Bala ₹300 |
| 9 | Add these to MCP Test Flat in one go: milk ₹60 split with everyone, and eggs ₹90 split between Bala and Chen. | `add_expenses` with 2 rows; "Added 2 expenses (₹150)" |
| 10 | Show this month's expenses in MCP Test Flat. | `list_expenses` with `month`; the expenses above, newest first, with ids |
| 11 | In MCP Test Flat, rename the most recent electricity expense to "Electricity bill". Don't change anything else. | `list_expenses`, then `edit_expense` with only `description`; the split stays exact ₹700 / ₹300, and the version goes up by 1 |
| 12 | Bala paid me ₹250 for October in MCP Test Flat. Record it. | `record_payment` from Bala to you, ₹250, for October |
| 13 | Who owes whom in MCP Test Flat, and what payments would settle it? | `get_balances`; each person's balance and "X pays Y ₹…" lines; the same numbers as the app's Balances tab |
| 14 | Add ₹100 for tea to MCP Test Flat, split with Zed. | `add_expense` fails with "No person called "Zed" … Choose from: …"; Claude tells you and asks. Nothing is added |
| 15 | Delete the beer expense in MCP Test Flat. | No tool can delete. Claude says it can't and to use the app. It must not edit the expense instead |
| 16 | Add an expense to MCP Test Flat for dinner. | Claude asks how much (and maybe who paid) instead of guessing. Nothing is added until you answer |

### Extra checks by hand
- **Ambiguous names:** "Add ₹100 to MCP Test Flat split with A". The tool replies that "A" could be Asha Rao or Bala Iyer, and Claude asks which.
- **Retry safety:** if Claude retries an add with the same `request_id`, the expense appears only once.
- **Revoking:** revoke the key in Settings, then ask anything. The connector fails: Claude reports an error, or the connector shows as disconnected.
- **Scope:** keys can't delete, merge people or manage keys, even through the API (403 `token_scope`).

After the run, open MCP Test Flat in the app. The expenses, splits, the payment and the balances should match what Claude reported.
