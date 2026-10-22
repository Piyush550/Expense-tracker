# MCP server for Expense Tracker: plan and free hosting

Status: **phase 1 built** (2026-10-21, PR #4): `/mcp` with personal keys, sent in the header **or in the address**, so Claude and ChatGPT can connect with "No authentication". OAuth (phase 2) is still a plan. Setup steps for users: [AI_APPS_SETUP.md](AI_APPS_SETUP.md).

## 1. Goal

Ask Claude or ChatGPT, including from their phone apps, things like:

> "Add ₹450 for dinner to Flat 4B, I paid, split with Bala and Chen."
> "What do I owe in the Goa trip?"
> "Log yesterday's groceries, 1,240, everyone in Daily sheet."

The assistant calls a **remote MCP server**. That server acts as you on Expense Tracker, with the same rules as the app: membership checks, validation, exact paise. It can **never delete anything**, matching the personal-key scope.

## 2. How it fits

```
Claude / ChatGPT (their servers, including from your phone)
   │ Streamable HTTP, JSON-RPC
   │ the personal key: https://…/mcp/et_…  or  Authorization: Bearer et_…
   │ (phase 2: an OAuth access token issued by Expense Tracker)
   ▼
MCP server  ── /mcp ──  tools: list_spaces, add_expense, get_balances, …
   │ calls the existing API as you (same token, same scope: no DELETE, no merge, no key management)
   ▼
Expense Tracker API (/api/...)  →  Postgres
```

**The MCP server is a thin layer over the existing API.** It turns tool calls into API calls and formats readable replies. All business rules stay in one place, the API.

## 3. Decisions

### D1. Where to host it: recommended, the same Netlify site

| Option | Free allowance (check before relying on it) | Fit | Verdict |
|---|---|---|---|
| **Same Netlify site**, new function at `/mcp` | Uses your existing Netlify plan credits (function calls). The database is woken either way | Same domain and code; calls the API code **in-process**, no extra network hop; no database credentials leave Netlify | **Recommended** |
| **Cloudflare Workers** | 100,000 requests/day; **10 ms CPU** per request | Fine for a thin proxy, since waiting on our API doesn't count as CPU. Cloudflare has ready-made MCP + OAuth libraries (`agents` 0.29, `@cloudflare/workers-oauth-provider` 1.2.3) | **Best separate free host**, if you want MCP traffic off Netlify |
| **Deno Deploy** | ~1M requests/month; ~50 ms CPU/request | Works as a proxy; smaller MCP ecosystem | OK alternative |
| **Vercel Hobby** | Free, but **non-commercial use only**; function and CPU caps | `mcp-handler` 2.3 makes it easy | OK for a personal project |
| Render (free) | Sleeps after idle; ~30–60 s cold start | Assistants time out waiting | Not suitable |
| Fly.io / Railway | No lasting free tier (trial credits only) | — | Not free |

**Why the same Netlify site:**
- One deploy, one domain, and the OAuth tokens live in the same database.
- The tools can call the API code directly instead of over HTTP.
- What an MCP call costs is mostly **waking the database** (about 10 Netlify credits per awake hour at the smallest size). That happens wherever the MCP layer runs, so a "free" host elsewhere saves little.

**When Cloudflare is better:** if Netlify function credits become tight, or you move the database to Neon. In that case Cloudflare can run the MCP layer for free as a proxy that calls `https://ggn-expense-tracker.netlify.app/api/...` with the user's token, holding no database credentials.

The code should be written so it can run either way. The tool layer depends on a small `ApiClient` interface:
- **on Netlify**, an in-process client using `app.fetch`;
- **on Cloudflare or Deno**, an HTTP client to the public API.

### D2. Sign-in: personal keys now, OAuth later

**Built (phase 1): the personal key, exactly as for the iPhone shortcut.**
- The key goes in `Authorization: Bearer et_…`, or, for apps whose connector form has no header field (Claude.ai, ChatGPT), as the last part of the address: `https://ggn-expense-tracker.netlify.app/mcp/et_…`. The connector is then added with **No authentication**: the address itself is the secret.
- Same scope and the same table as the shortcut: everything except DELETE, merging people and key management. Revoke the key in Settings and the connector stops at once.
- Trade-off: the address must be kept private like a password. It is stored by Claude/ChatGPT as connector configuration, and may appear in Netlify's request logs. One key per app (name it "Claude", "ChatGPT") keeps each revocable on its own.

**Phase 2 plan: OAuth 2.1 with PKCE, issued by Expense Tracker.** Removes the secret from the address.

- **Claude** custom connectors support no auth, OAuth with Dynamic Client Registration (DCR), and Client ID Metadata Documents (CIMD).
- **ChatGPT** developer-mode connectors support no auth, OAuth (static credentials, CIMD or DCR) and "mixed".
- No auth is not acceptable here: the tools read and write personal money data.

**Plan:** Expense Tracker becomes its own small OAuth authorisation server.
- **Endpoints:**
  - `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` (metadata)
  - `/oauth/register` (DCR)
  - `/oauth/authorize`: a consent page in the app. You sign in with Google or email as usual, then "Allow Claude to read your spaces and add expenses?"
  - `/oauth/token`: issues access + refresh tokens.
- **Tokens:**
  - Rows in the existing `api_tokens` table, with a new `kind` (`personal` | `oauth_access` | `oauth_refresh`) and the client they were issued to.
  - Same scope rules as personal keys: everything except DELETE, merging people and key management.
  - Access tokens last 1 hour. Refresh tokens last 90 days and are rotated on every use.
- **Rules:** PKCE `S256` is mandatory; codes are single-use and expire after 10 minutes; redirect URIs must match the registered ones exactly.
- **Settings:** a new "Connected apps" section, beside "iPhone shortcut", lists each assistant connection with when it was last used and a **Disconnect** button.
- **CIMD:** add it after DCR works. The MCP ecosystem is moving from DCR to CIMD.
- Personal keys keep working alongside OAuth, for clients that can set headers (Claude Code, MCP Inspector) and for anyone happy with the key-in-address form.

### D3. Transport and libraries

- **Streamable HTTP**, stateless: every request stands alone and replies with plain JSON (no long-lived SSE streams). That suits serverless functions.
- `@modelcontextprotocol/sdk` 1.32 (official TypeScript SDK) with `@hono/mcp` 0.3. The latter is the transport for Hono, which the API already uses, so the MCP endpoint fits the existing server code.
- The protocol version is whatever the SDK negotiates. Pin the SDK version, and re-test when upgrading.

## 4. Tools

Every tool acts as the signed-in user. Write tools are marked so assistants ask you before running them. **No delete tools.**

| Tool | What it does | Kind |
|---|---|---|
| `list_spaces` | Your spaces: kind (monthly/one-time), members, your balance in each | read |
| `get_space` | One space: members, groups, quick actions, months with activity | read |
| `list_expenses` | Expenses in a space, filterable by month, text, payer or person (people who have left included); newest first; paged with `offset`. Filtering, paging, counts and totals all run in the database (`/expenses/page`), so nothing is lost past any row cap | read |
| `list_payments` | Settle-up payments: date, who paid whom, the month settled, note; filter by month or person (people who have left included); paged (default 50) with exact count and total (`/settlements/page`) | read |
| `get_balances` | Who owes whom, as "A pays C ₹x", plus each person's net, for a month or all time | read |
| `add_expense` | Space, title, amount (₹), date ("today", "21 Oct"), paid by (name or "me"), split type (equal / exact / percent / shares) and people or a group. Returns a summary and your new balance | write |
| `add_expenses` | Several expenses at once, each with its own date, payer and split. Uses bulk add, so all are saved or none | write |
| `edit_expense` | Change the title, amount, date, payer or split of an expense (from `list_expenses`). The version read is required, so it never overwrites someone else's edit; new split values keep the current split type; an edit with no fields writes nothing | write |
| `record_payment` | "Chen paid me 500 for September" | write |

**Behaviour rules for the tools:**
- **Names, not IDs.** Tools take space, people and group **names**, matched case-insensitively within the space; "me" means you. If a name is ambiguous or unknown, the tool returns an error listing the valid options, so the assistant asks you instead of guessing.
- **Money is exact.** Amounts are numbers in rupees, converted to whole paise. More than 2 decimals (₹1.005, a ₹0.504 share, a 33.333% split) is refused with a message to ask the user, never rounded silently.
- **Names that could mean two things are refused, not guessed.** A person and a group with the same name, two groups with one name, or a group called "Everyone" get an error listing both; `group:Name` / `person:Name` pick explicitly. An empty `split_between`, or a group whose people have all left, is refused instead of widening to everyone.
- **Dates.** They're read with the app's own date parser (`shared/dates.ts`). Bare days land in the current month, in India time.
- **No duplicates on retry.** Write tools accept an optional `request_id`. The row id is derived from it plus the resolved content (people sorted), so a true retry is saved once, even with the people listed in another order, while a reused id with different details makes a new row rather than silently returning the old one. A write that saved is reported as saved even if the balance read after it fails.
- **Readable replies.** Each reply is short text the assistant can repeat back ("Added to Flat 4B: … · split equally … You're owed ₹450 in Flat 4B."). Errors come back as readable tool errors, not protocol errors, so the assistant can relay them.
- **Hints for assistants.** Tool annotations: `readOnlyHint` on read tools; `destructiveHint: false` on write tools; `idempotentHint` where a `request_id` is given.

## 5. What has to be built

| # | Piece | Notes |
|---|---|---|
| 1 | ✅ `netlify/functions/mcp.ts` at `/mcp` and `/mcp/*` | Hono + `@hono/mcp`, stateless JSON; 120 requests/min per IP. Personal key from the header or the address |
| 2 | ✅ `server/mcp.ts` | The tools above, calling the API in-process (`app.fetch`) with the key, so scope and validation are the API's own. `GET /api/expenses/:id` was added for `edit_expense`. The API setup is shared with `/api` through `server/production.ts` |
| — | ✅ Settings → iPhone & AI apps | A new key also shows its **connector address** (`/mcp/et_…`) with a copy button, plus Claude/ChatGPT steps |
| — | ✅ Tests | `tests/mcp.test.ts`: the real SDK client over HTTP, key in address and header, bad/revoked keys, every tool, retry safety, all-or-nothing bulk add, version checks |
| 3 | Migration `0004_oauth.sql` | `oauth_clients` (DCR registrations), `oauth_codes` (hashed, single-use, 10 min), and new `api_tokens` columns: `kind`, `client_id`, `refresh_parent` |
| 4 | OAuth endpoints and `/.well-known/*` metadata | In the API function, or a small `oauth` function. Must answer 401 with `WWW-Authenticate: Bearer resource_metadata=…` so clients find the sign-in |
| 5 | Consent page `/oauth/authorize` in the React app | Shows the client's (self-declared) name, the scope in plain words, and Allow / Deny |
| 6 | Settings → **Connected apps** | List, last used, Disconnect (revokes the access and refresh tokens) |
| 7 | Tests | Tool behaviour against PGlite; OAuth flow (PKCE, code reuse, redirect checks, refresh rotation); scope (no delete through MCP) |
| 8 | ✅ Docs | [AI_APPS_SETUP.md](AI_APPS_SETUP.md): connect Claude and ChatGPT step by step |

## 6. Phases

| Phase | Outcome | Effort (rough) |
|---|---|---|
| **1. MCP with personal keys** ✅ | `/mcp` live; Claude.ai and ChatGPT connect with the key in the address (No authentication); Claude Code and MCP Inspector can use the header | done |
| **2. OAuth** | Claude.ai and ChatGPT can connect by URL, sign in with Google, and press Allow; Connected apps in Settings | ~2–3 days |
| **3. Real clients** | Connected and tested in Claude (web and phone) and ChatGPT developer mode | ~½ day |
| **4. Hardening** | An activity log of changes made through MCP; CIMD support; per-client rate limits | ~1–2 days |

## 7. Free deployment steps (recommended path)

1. Build on a branch. `netlify.toml` needs no change: the new function in `netlify/functions/` is picked up automatically, and its `config.path = "/mcp"` claims the URL.
2. The migration runs on deploy, as today.
3. Phase 1 smoke test:
   ```bash
   npx @modelcontextprotocol/inspector
   ```
   Transport "Streamable HTTP", URL `https://ggn-expense-tracker.netlify.app/mcp/et_…` (or `/mcp` with header `Authorization: Bearer et_…`).
4. Phase 1 in real apps: see [AI_APPS_SETUP.md](AI_APPS_SETUP.md).
5. Phase 2: in **Claude** go to Settings → Connectors → *Add custom connector*, enter the URL `https://ggn-expense-tracker.netlify.app/mcp`, sign in and Allow. In **ChatGPT**, turn on developer mode (an admin may need to enable it), create a connector with that URL and choose OAuth.

**Cloudflare variant** (if MCP should run off Netlify):
1. Create a Worker, `wrangler init`, using `agents` (McpAgent) + `@cloudflare/workers-oauth-provider`. *Or* keep OAuth on Netlify and make the Worker a pure proxy that forwards the bearer token.
2. Set `EXPENSE_API_BASE=https://ggn-expense-tracker.netlify.app/api`.
3. `wrangler deploy` gives a `*.workers.dev` URL; add that as the connector URL.
4. No database credentials are stored on Cloudflare.

## 8. Cost

- Each assistant conversation that uses the tools makes a few API calls.
- On Netlify, that's function calls plus **database awake time**: at least 5 minutes per wake, about 10 credits per awake hour.
- Occasional use from a phone adds little compared with using the app itself.
- Cloudflare's free allowance (100,000 requests a day) won't be reached by personal use.

## 9. Risks and open questions

- **ChatGPT plan limits.** Reports say Plus and Pro may only allow *read-only* custom connectors, with write actions on Business, Enterprise and Education plans. Check your ChatGPT plan before relying on it for adding expenses. Claude custom connectors need a plan that includes them.
- **Prompt injection.** Text inside expenses (titles, remarks) is returned to the assistant. Tools return it as data, write tools still ask for your confirmation, and there are no delete tools. That limits the damage a malicious expense title could do.
- **DCR is being replaced by CIMD.** Build DCR first, since both clients support it today, then add CIMD.
- **Time limits.** Netlify functions have a 10-second default timeout. Tools make at most a few fast queries, but bulk adds should stay capped (50 rows, as today).
- **Shared spaces.** Other members see expenses an assistant added on your behalf, exactly as if you'd added them in the app, with you shown as creator.

## Sources

- Claude: [Building custom connectors via remote MCP servers](https://support.claude.com/en/articles/11503834), [Connector authentication](https://www.claude.com/docs/connectors/building/authentication)
- ChatGPT: [Developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
- Cloudflare: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/index.md)
- Deno: [Deploy pricing](https://deno.land/deploy/pricing)
- Vercel: [Hobby plan](https://vercel.com/docs/plans/hobby), [Fair use](https://vercel.com/docs/limits/fair-use-policy)
- Free tiers overview: [flaviocopes.com/hosting-free-tiers](https://flaviocopes.com/hosting-free-tiers/)
