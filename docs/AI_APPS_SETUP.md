# Use Expense Tracker from Claude or ChatGPT

Ask an assistant, on the web or in its phone app:

> "Add ₹900 dinner yesterday, split between me and Bala in Flat 4B."
> "Who owes whom in Flat 4B this month?"
> "Bala paid me 500 for October."

The assistant uses Expense Tracker's MCP server at `https://ggn-expense-tracker.netlify.app/mcp`. It signs in with a **personal key**, the same kind the iPhone shortcut uses. It can read your spaces and add or edit expenses and payments. It **can't delete anything**, merge people or manage keys.

---

## 1. Create a key and copy the connector address

1. Open `https://ggn-expense-tracker.netlify.app` and sign in.
2. Click your name at the bottom left → **iPhone & AI apps**.
3. Name the key after the app, e.g. `Claude`, choose an expiry, then click **Create key**.
4. Click **Copy connector**. The address looks like this:
   `https://ggn-expense-tracker.netlify.app/mcp/et_…`

> **Keep this address private, like a password.** Anyone who has it can add expenses as you. Use one key per app: you can then revoke one without breaking the others. The key is shown only once. If you lose it, create a new key.

## 2a. Claude

Add the connector once on the website. The Claude phone app picks it up when you sign in with the same account.

1. Go to **claude.ai** → **Settings** → **Connectors** → **Add custom connector**.
2. **Name**: `Expense Tracker`.
3. **Remote MCP server URL**: paste the connector address.
4. Leave **Advanced settings** (OAuth Client ID and Secret) empty, then click **Add**.
5. In a chat, open the tools menu (the **+** or sliders button) and turn **Expense Tracker** on.

Custom connectors depend on your Claude plan (the Free plan allows one). On a Team or Enterprise plan, an owner may need to allow them.

## 2b. ChatGPT

1. Go to **chatgpt.com** → **Settings** → **Apps** (called *Apps & Connectors* or *Connectors* in some versions) → **Advanced settings** → turn on **Developer mode**.
2. Back in **Apps**, click **Create** (or *Create app*).
3. **Name**: `Expense Tracker`. **Description**: `My shared expenses`.
4. **MCP server URL**: paste the connector address.
5. **Authentication**: **No authentication**. The key is already in the address.
6. Tick **I trust this application**, then click **Create**.
7. In a chat, click **+** → **More** → **Developer mode**, and pick **Expense Tracker**.

Developer mode is a ChatGPT beta and depends on your plan. Some plans allow only read actions from custom apps. If adding expenses is refused, use Claude, or ask ChatGPT only for balances and lists. If the app doesn't appear in the ChatGPT phone app, use it from chatgpt.com.

## 3. What you can ask

| Tool | Ask things like |
|---|---|
| `list_people` | "Who is registered on the platform?" "Find Bala." (paginated names and app IDs; no emails) |
| `create_space` | "Create a one-time space called Goa weekend with Bala and Chen." (you become owner; registered users only) |
| `list_spaces` | "Which spaces am I in and where do I stand?" |
| `get_space` | "Who's in Flat 4B? What groups are there?" |
| `list_expenses` | "Show October's expenses in Flat 4B." "Which expenses involve Bala?" "Find the electricity bills." (filters: month, who paid, who has a share, text; pages past 50) |
| `list_payments` | "Show the payments Bala made, with dates and notes." |
| `get_balances` | "Who owes whom in Goa trip?" "How do we settle last month?" |
| `add_expense` | "Add ₹1,240 groceries to Flat 4B, Chen paid, split with the Boys group." "Cab ₹1000, me 60%, Bala 40%." |
| `add_expenses` | "Add these from the trip: …" (up to 50; all are saved, or none) |
| `edit_expense` | "Change yesterday's dinner to ₹950." |
| `record_payment` | "Bala paid me ₹500 for October." |

- **Names**: use people's names (first names work if they're unique), group names, or "me". If a name doesn't match, or could mean two things (a person and a group with the same name, two groups with one name), the assistant is told the choices and asks you.
- **Who shares**: only the people or groups you name share the cost. "Split with Chen" means Chen alone; say "between me and Chen" to include yourself.
- **Defaults**: you paid, split equally between everyone in the space, dated today (India time).
- **Amounts** are in rupees, to the paisa. An amount with more decimals (₹1.005) is refused, never rounded.
- **Edits** need the version the assistant last saw, so an edit made meanwhile in the app is never overwritten.
- **Deleting** isn't possible here. Do it in the app.

Expenses added this way appear for everyone in the space, as if you'd added them in the app.

## Stop an assistant's access

Go to **iPhone & AI apps** in the app and click **Revoke** on that app's key. The connector stops working at once. You can also remove the connector in Claude or ChatGPT settings.

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| The connector fails to connect, or asks to sign in | The key in the address is wrong, revoked or expired | Create a new key and update the connector's URL with the new **connector address** |
| "This key is not valid any more" | The key was revoked, regenerated or expired | Same as above |
| "A key can't delete …" | Deleting, merging people and managing keys need the app | Do it in the app |
| "No person called …" / "could be A or B" | A name doesn't match exactly one person | Use the full name as shown in the space |
| "Someone changed this expense since" | It was edited after the assistant read it | Ask the assistant to look at it again, then edit |

## For developers

- **Endpoint**: `POST /mcp` (key in `Authorization: Bearer et_…`) or `POST /mcp/et_…`. It uses Streamable HTTP, stateless, with JSON replies; `GET` and `DELETE` answer 405.
- **Code**: `server/mcp.ts`; the Netlify function is `netlify/functions/mcp.ts`. Tools call the API in-process with the key, so key scope and validation are the API's own.
- **Local**: run `npm run dev:local` to serve `/mcp` on `http://localhost:5173` as well. Test with `npx @modelcontextprotocol/inspector`, transport Streamable HTTP.
- **Tests**: `tests/mcp.test.ts`. To test with real Claude, use the prompts and runner in [MCP_TEST_PROMPTS.md](MCP_TEST_PROMPTS.md).
- **Design and next steps (OAuth)**: [MCP_SERVER_PLAN.md](MCP_SERVER_PLAN.md).

For the People page, new-space creation, retry behavior and extra test scenarios, see [Platform people and MCP space creation](PLATFORM_PEOPLE_MCP.md). Refresh your connector after deployment to discover all 11 tools.
