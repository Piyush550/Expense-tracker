# Expense Tracker

A shared expense tracker: log who paid and who shared it, split equally, by exact amounts,
by percentage or by shares, and settle up with the fewest payments.

## Concepts

- **Space**: where expenses live. Anyone can create one and becomes its owner.
  - Owners add people by name, invite someone new with their name and sign-in email, and change settings.
  - Everyone in a space can see it, and add and edit its expenses and payments.
  - A space is one of two kinds:
    - **Recurring** (flat groceries): the same people every month, settled month by month. Pick a
      month to see that month's expenses, balances and payments, or "All months". The
      *Month by month* sheet shows what each month cost and what is still unsettled.
    - **One-time** (a trip): settled once, over everything.
- **Group**: a saved list of people belonging to one space ("Boys Flat": Ishan, Piyush).
  - Select current space members, including or excluding yourself, and pick them for an expense in one click.
  - Everyone in the space can use its groups; space owners create, edit and delete them.
- Inside a space, the tabs are **Expenses** (with search and filters for who paid and who is
  involved), **Balances & settle up** (the balance sheet plus the ordered list "A pays C ₹x"),
  **Members**, **Groups**, **Quick actions** and **Settings**.

```
Browser (React + Vite)
  │  1. Sign in with Google or email/password (Firebase Authentication)
  │  2. fetch /api/... with "Authorization: Bearer <Firebase ID token>"
  ▼
Netlify Function  netlify/functions/api.ts  (Hono, served at /api/*)
  │  verifies the token, checks space membership, validates input,
  │  computes splits and balances (shared/)
  ▼
Netlify Database (Postgres)   schema: netlify/database/migrations/
```

Everything deploys as one Netlify site from one repo. Firebase is only used for sign-in.

## Display and navigation

The Ledger design uses IBM Plex fonts and a green accent, with Light, Dark and Auto themes.
The theme switch stays in the sign-in header; on phones its three icons have accessible
labels and tooltips. Sign-in, account creation, password reset and email verification use
the same responsive card layout.

The signed-in app has a sidebar above 960 px and a space strip with a Menu button on smaller
screens. Space tabs scroll horizontally on phones ("Balances & settle up" is shortened to
"Balances"). Forms adapt to the content width, including when the sidebar is present.
The desktop dashboard fills the available workspace, with text and controls scaling up
on wider displays at normal browser zoom. Wide expense lists show aligned column headings.
Expense lists fill the workspace. Single-expense, bulk-expense and group editors open in
centered dialogs with a scrollable body, visible save controls, trapped focus and Escape
support. Unsaved expense/group changes require a discard confirmation; bulk drafts stay on
the device when closed. **Groups** is a tab inside each space (also linked from Members), with searchable cards, an "Including you" filter and
centered create/edit/view dialogs. Payment forms keep a readable maximum width.

In Expenses, **+ Add expense** and **Add several** are the primary actions. **Export** opens
the CSV download choices for the current month or everything; Escape closes those choices.

Month navigation allows empty past and future months. Click the month for a twelve-month
grid, type a year or use the year arrows, and use **This month** or **All months** to return.
Arrow keys move through the month grid; Escape closes it and restores focus. Dots mark
months with recorded activity, without restricting which months can be selected.

The single-expense dialog uses compact details beside a searchable split checklist. Each
person appears once, with their calculated share or editable amount, percentage or shares.
**Everyone**, **Clear** and saved groups are quick selections. Arrow keys move between
people; Enter toggles a selection (or the first search result), and Space toggles a focused
checkbox. The participant list scrolls independently for large spaces. The ordinary
small-group form fits a 1366 × 768 laptop viewport at 100% zoom; smaller screens stack the
sections and allow scrolling. **Save & add another** keeps the date, payer and people,
clears the description, amount and remarks, and creates a fresh expense ID. Exact split
amounts are cleared; percentage/share weights are retained.

The **Individuals / Groups** toggle beside **Split** changes the participant picker without
changing the expense, payer, split method, selected people or entered values. Groups use a
searchable checklist in the same list area. Selecting the first group replaces the current
people; additional checked groups combine their members, with overlapping people counted
once. Unchecking a group keeps anyone still included through another checked group.
Only current members of this space can be included. Former members are excluded from new
group selections; groups without current members are disabled. **Review individuals** returns
to per-person shares and editable values. Manually changing people clears the group shortcut
labels; amounts already entered are retained for later reselection and must still validate.
Saved expenses contain explicit people and shares, so later group edits cannot change them.

Bulk entry uses transaction rows with an adjacent editor for the selected row's split.
Each row owns its payer, participants, split method and values: equal, exact amounts,
percentages or shares. The date applies to the batch. **Copy split to next expense** is an
explicit copy; editing one row never changes another. Enter in an amount moves to the next
row, creating one when needed. Up to 50 rows are saved atomically. Drafts remain browser-only;
older drafts are upgraded on reopening by resolving their shared defaults into each row,
preserving their expense IDs and existing overrides.
Each row also retains its selected group names and membership snapshots in its local draft.
Copying a split copies those snapshots independently; changing one row or editing a saved
group does not silently change another draft row's participants.

## In-app Docs

Open **Docs** under Discover in the signed-in sidebar (on phones, open **Menu** first).
The page at `?v=docs` is one continuous, scrollable guide: a welcome section, a three-step
workflow, a sticky topic bar, and eight fully expanded sections. It covers space setup,
expenses and split methods, groups and quick actions, balances and repayments, people and
membership, iPhone/AI integrations, settings, and common terms. Topic links jump within the
page, such as `?v=docs#docs-expenses`; they never replace the content with another screen.
Old `?v=docs&doc=expenses` links still scroll to the matching section. People and integration
sections retain links to the relevant app pages. Technical setup and API documentation
remain in this README and `docs/`.

## Space groups, onboarding and Quick actions

New spaces use three steps: **Details & people → Groups → Quick actions**. Groups and
shortcut configuration are optional. Space creation, its initial groups and the chosen
shortcuts save in one transaction; an invalid group rolls everything back. Email invitees
can be added to groups after creation, once their app IDs have been resolved.

**Quick groups** appears above search in the right-hand split panel, in both Individuals
and Groups views. Click multiple shortcuts to combine groups; overlapping people count
once. The picker view stays open, and bulk shortcuts affect only the selected transaction.
Long names truncate with a full-name tooltip; phones keep one horizontally scrollable row.

Without configuration, the newest **up to three** groups appear, ordered by `createdAt`
descending with a stable ID tie break. This also applies when there are more than three
groups. The **Quick actions** space tab is visible to all members; owners can select one to
three groups and reorder them, or choose **Use latest groups** to restore automatic mode.
Owners can also use **Edit** above the shortcuts inside either expense popup, configure in
place, save, and return without losing entered expense fields. Deleting a pinned group
removes its shortcut; deleting the last pin restores automatic mode.

Group management lives only inside a space. The global sidebar Groups section, global
`/groups` API, unassigned-group import UI and group-copying logic have been removed.
Group rows require a non-null space ID; the API rejects people and shortcuts from other
spaces. Owners create groups from the space’s **Groups** tab, also linked from **Members**
and **Quick actions**. Onboarding can still create initial groups in the same transaction.

There is no group data migration. `0002_space_groups.sql` discards the development group
tables and defines the space-only schema, leaving spaces, people, expenses and settlements
alone. The deployed `0001_init.sql` is unchanged. Existing sample groups are intentionally
cleared; create new groups within their spaces. The saved cache version is bumped so the
previous global navigation and group data are not reused.

## People and sign-in

Every user is stored in Postgres with a stable app UUID, their display name, email and a
separate Firebase `auth_uid`. Firebase authenticates the sign-in; the API stores the verified
identity in the app database on first use. A verified matching email claims an invitation
without changing its UUID or losing its existing memberships. Existing custom app names
are retained on later sign-ins. Google sign-in is the primary option; email/password,
account creation, password reset and email verification remain available.

Space creation and adding space members use a directory of all registered app users.
Group editors list only current members of their space. The directory requires authentication and returns names and app UUIDs with
`email: null`; it never returns email addresses or Firebase UIDs. Users appear after their
first authenticated API request, rather than through a Firebase admin account listing.
Existing invited/imported contacts are also available. Search names and press Enter to
select a result, or click its checkbox; multiple people can be selected. Groups, Members
and onboarding use a contained selection panel with a search field, clear checked rows,
**All / Selected** views and a live selected count. **Select all** selects the current view;
when searching, **Select matches** adds the matching people without clearing earlier picks.
**Clear** removes the selection. The list scrolls independently and never overlays the
form fields or save controls. Arrow keys move the highlight, Enter adds a person without
submitting the form, and Escape clears an active search before closing the editor.
Expense split checklists are restricted to the people in that space, with a separate
selection for every bulk row; they do not expose the registered-user directory.

Someone who has not joined can be queued with their name and sign-in email. No invitation
email is sent. Duplicate names are not disambiguated in the UI yet; selections already use
stable user IDs. Existing membership and group detail APIs retain their prior email fields.

## Layout

```
src/                     React app (TanStack Query for server state)
  components/            one component per section of the page
  lib/                   api client, auth, queries, export, theme
server/                  the API: routes (app.ts), auth, access checks, queries
shared/                  used by both sides: money, dates, split + settle-up logic, API types
netlify/functions/api.ts the Netlify Function that serves server/app.ts at /api/*
netlify/database/migrations/  SQL migrations, applied by Netlify on every deploy
scripts/                 local dev server, seed data, Firebase → Postgres import
tests/                   unit tests and API tests against a real Postgres engine (PGlite)
legacy-firebase/         the retired Realtime Database rules, kept for the cut-over
```

## How the money logic works

All amounts are integer **paise** (`BIGINT`), never floats.

- **Splitting** (`shared/split.ts`): each person's share is stored when the expense is saved.
  Shares always add up to exactly the amount. Uneven splits use largest-remainder
  (Hamilton) rounding, and the spare paisa rotates between people from one expense to the next.
  - *Equal*: everyone ticked.
  - *Exact*: amounts must add up to the total.
  - *Percent*: must add up to 100%, stored as basis points.
  - *Shares*: e.g. 1 : 2 : 1.
- **Balances** (`server/ledger.ts`): net = paid for expenses − own shares + payments made −
  payments received. A space's balances always sum to zero. In a recurring space, a month's
  balance counts that month's expenses and the payments recorded *for* that month
  (`settlements.period`). That date can differ from the payment date: September's dues paid on
  2 October still settle September.
- **Settle up** (`shared/settlement.ts`): with *Simplify debts* on, the space gets the true
  minimum number of payments. It finds the most zero-sum sub-groups (exact up to 16 people
  with a balance, checked against brute force in the tests). With it off, each person pays
  back exactly who they owe.
- **Payments** are recorded as rows (`settlements`), not ticks, so editing an old expense can
  never silently undo a payment.

## Security model

The API is public on the internet. Security comes from the code:

1. Every `/api` request needs a Firebase ID token. `server/auth.ts` verifies its RS256
   signature against Google's keys, plus the issuer, audience, expiry and a verified email.
   The one exception is a **personal key** (`et_…`, see "iPhone shortcut" and "AI apps (MCP)" below): it signs in
   as the user who made it and can use every route **except** destructive ones: any `DELETE`,
   merging a member (`POST /api/spaces/:id/members/:userId/merge`) and anything under
   `/api/tokens`. Those answer 403 `token_scope` and need a normal sign-in, so a stolen key
   cannot delete data or mint more keys. Only a SHA-256 hash of each key is stored
   (`api_tokens`), and the key is shown once.
2. Every space route checks the caller is an active member. Outsiders get 404, so a space's
   existence is not revealed. Only owners can add or remove people or change settings. Space
   groups and shortcuts are visible to every active member of that space.
3. All input is validated with zod. Payer and participants must be space members.
   `memberIds` remains contacts-only. The explicit `directoryIds` input accepts registered
   users from the authenticated name directory; it rejects unknown and unclaimed placeholder
   IDs. Space owners manage scoped groups and shortcuts. Group member IDs must be current
   members of that same space; shortcut IDs must belong to that space. Batch additions are atomic.
4. Writes are safe to retry: clients send the new row's id, so a retried request can't
   create a duplicate. Edits carry a `version`, so two people editing at once get a
   conflict instead of a silent overwrite.
5. Netlify rate-limits the function per IP. `netlify.toml` sets a strict
   Content-Security-Policy and the usual security headers.

The database URL is injected by Netlify at runtime and never reaches the browser.

## Running locally

Needs Node 20.12+ (22 recommended).

```bash
npm install
```

**Option A: fully offline** (local Postgres via PGlite and the Firebase Auth emulator; nothing
touches the real project):

```bash
npm run dev:local
```

The local API automatically ensures a verified **Test** login is available on startup:

- Email: `test@gmail.com`
- Password: `test`

This is an emulator-only fixture; it does not create a real Google/Firebase account or send
email. The short password is loaded through the emulator fixture importer; ordinary signup
still requires six characters. The Test account starts with its own empty workspace.

To recreate just this login while the emulator is running, without duplicating demo data:

```bash
npm run seed:local:user
```

Your browser password manager can save this login for `http://localhost:5173` (when enabled).
Firebase also persists the signed-in session in browser storage. Local expense data is stored
in `.local-db/`; clearing browser storage does not delete those database records. The Auth
emulator itself is temporary, but the Test login is recreated when the local stack restarts,
reusing the same fixture uid. Sign in again if a restart invalidates the browser session.

For the existing sample spaces and other demo accounts, run this once in another terminal:

```bash
npm run seed:local
```

Open http://localhost:5173 and sign in as `asha@example.test`, `bala@`, `chen@` or `dev@example.test`.
The password is in `scripts/seed-local.ts`. You get a recurring "Flat 4B" space, a one-time "Goa trip" and a
"Boys Flat" group. Google sign-in opens the emulator's fake account picker.

**Option B: like production** (Netlify CLI 26+ with its local database and real Firebase sign-in):

```bash
npm install -g netlify-cli && netlify link
```
```bash
netlify database migrations apply && netlify dev
```

Checks (the same ones Netlify runs before every deploy):

```bash
npm run ci
```

## Deploying

Push to the branch Netlify builds. The build runs `npm run ci` (type-check, tests, build).
Netlify then applies new migrations and publishes. A failing test or migration blocks
the deploy.

One-time setup:

- **Netlify**: the database already exists under the site's *Database* tab, and Netlify
  injects its connection string itself, so there's nothing to configure. Optionally set
  `FIREBASE_PROJECT_ID` if you ever move to another Firebase project.
- **Firebase console → Authentication**:
  - *Sign-in method*: enable **Google** and **Email/Password**.
  - *Settings → Authorized domains*: add your Netlify domain, e.g. `your-site.netlify.app`.
    Google sign-in fails on any domain not listed here, including deploy-preview URLs.

### Moving the old data (one time)

The import only moves the old Realtime Database data into Postgres; Firebase sign-in
stays as it is. Everyone keeps the same Firebase account, so their old expenses are
theirs the moment they sign in.

1. Freeze and export the old data: see [legacy-firebase/README.md](legacy-firebase/README.md).
2. Get the production connection string:
   ```bash
   netlify database status --branch main --show-credentials
   ```
3. Dry run (prints the balances it would create; nothing is saved):
   ```bash
   DATABASE_URL='postgres://…' npm run import:firebase -- firebase-export.json --space-name "Flat 4B" --owner-email you@gmail.com --dry-run
   ```
4. Check the balances against the old app, then run it again without `--dry-run`.
   Running it twice is safe.

What the import does:
- Everything goes into one **recurring** space, because the old app was a single ledger settled monthly.
- Old "Paid" ticks become payments recorded for their month.
- Optional old quick-pick lists belong to the imported space, with no global group list.
- Names from the old fixed list that nobody claimed become members without an account.
  A space owner can link each one to a real person later (Members → *Link to…* or *This is me*).
- Equal splits are recalculated, so an odd paisa may land on a different person than before.

## API

All routes are under `/api`, need `Authorization: Bearer <token>`, and return JSON.
Errors look like `{ "error": { "code", "message" } }`.

| Method | Path | |
|---|---|---|
| GET / PATCH | `/me` | your profile (`name`) |
| GET | `/people` | existing contacts (shared spaces) |
| GET | `/people/directory` | all registered app users except yourself; names and UUIDs, email redacted |
| GET | `/people/directory/page` | paginated registered users including yourself; `search`, `limit` (1–200), `offset`; names and app IDs only |
| GET / POST | `/spaces` | your spaces / create (optional retry-safe client `id`, `name`, `kind`, `memberIds`, `directoryIds`, `memberInvites`, optional `initialGroups` and `quickGroupIds`; `memberEmails` also supported) |
| GET / PATCH / DELETE | `/spaces/:id` | details, members and active months / owner: `name`, `kind`, `simplifyDebts` / owner: delete (all settled) |
| POST | `/spaces/:id/members` | owner: batch `{ memberIds, directoryIds, memberInvites }`, or `{ userId }`, `{ email }` |
| PATCH / DELETE | `/spaces/:id/members/:userId` | owner: set `role` / leave yourself, or owner removes (balance must be 0) |
| POST | `/spaces/:id/members/:userId/merge` | link a name without an account to `intoUserId` |
| GET | `/spaces/:id/balances?month=YYYY-MM` | per-person totals and the payments that settle them (no `month` = all time) |
| GET | `/spaces/:id/months` | month-by-month sheet: spent, count, still to settle |
| GET / POST | `/spaces/:id/expenses?month=YYYY-MM` | list / create (client-generated `id`) |
| PATCH / DELETE | `/expenses/:id` | edit (send `version`) / delete |
| GET / POST | `/spaces/:id/settlements?month=YYYY-MM` | payments for a month / record one (`period` = month it settles) |
| DELETE | `/settlements/:id` | delete a payment |
| GET / POST | `/spaces/:id/groups` | space groups / owner creates (`name`, `memberIds`) |
| PATCH / DELETE | `/spaces/:id/groups/:groupId` | owner updates / deletes a group belonging to this space |
| GET / PUT | `/spaces/:id/quick-actions` | shared configuration / owner saves `{ mode: "automatic" }` or `{ mode: "custom", groupIds: […] }` (1–3 unique IDs) |
| GET / POST | `/tokens` | sign-in only: your personal keys / create `{ name, lifetimeDays }` (`null` = never expires; the key is in the reply once) |
| PATCH / DELETE | `/tokens/:id` | sign-in only: rename or new expiry from today / delete a revoked or expired key |
| POST | `/tokens/:id/regenerate`, `/tokens/:id/revoke` | sign-in only: new secret for the same entry (old one stops at once) / revoke |
| GET | `/expenses/:id` | one expense, if you're in its space |
| GET | `/spaces/:id/expenses/page` | `?month&payer&involving&q&limit&offset`: one page plus the count, total and (with `involving`) that person's share of **every** match; filtering and paging run in the database (used by the MCP server) |
| GET | `/spaces/:id/settlements/page` | `?month&person&limit&offset`: one page of payments plus the count and total of every match |
| GET, POST | `/quick/options` | key or sign-in (keys also work on all other non-destructive routes): `{ labels, presets }`, each space as "Everyone" plus its quick-action groups. POST is accepted too, because a GET with a body (an easy Shortcuts mistake) fails at Netlify |
| POST | `/quick/people` | key or sign-in: `{ preset }` → plain JSON list of the space's member names, for "Who shared it?" |
| POST | `/quick/expense` | key or sign-in: `{ preset, amount, title?, date?, requestId?, people? }` (`people`: names as a list or one per line; empty = the preset's people): equal split, paid by you, dated today (India time) by default; returns `{ message, expense }` |

## iPhone shortcut

A personal key lets Apple's Shortcuts app add expenses as you, for example a prompt every
time you close Swiggy. Create one under **Settings → iPhone & AI apps** (the account button at the
bottom left of the sidebar opens Profile, iPhone & AI apps, Appearance and Sign out). The page shows the key
once, lists your keys with when each was last used, and lets you rename, change the expiry,
regenerate (new secret, old one stops at once), revoke, and delete revoked ones. Each user can
have up to 10 active keys.

The shortcut ("Log expense"):

1. **Text**: the key.
2. **Choose from Menu** "Spent something?": Yes / Skip (Skip → **Stop This Shortcut**).
3. **Get Contents of URL** `https://<site>/api/quick/options`, header
   `Authorization: Bearer <key>`.
4. **Get Dictionary Value** `labels`, then **Choose from List** "Which space / group?".
5. **Get Contents of URL** `https://<site>/api/quick/people`, POST, same header, JSON body
   `preset` (Text) = the chosen item. The reply is a plain list of names.
6. **Choose from List** "Who shared it?" on that reply, with **Select Multiple** on
   (and **Select All Initially** if you usually split with everyone).
7. **Ask for Input** (Number) "Amount (₹)", then **Ask for Input** (Text) "What for?" with
   default **Shortcut Input**.
8. **Get Contents of URL** `https://<site>/api/quick/expense`, POST, same header, JSON body
   `preset` (Text) = the step 4 choice, `amount` (Number), `title` (Text), `people` (Text) =
   the names ticked in step 6. Ticking nobody splits with the step 4 choice's people.
9. **Get Dictionary Value** `message`, then **Show Notification**. The reply always has a
   `message`: on success "Added ₹450 Swiggy to Flat 4B · split 3 ways…", on failure for example
   "Couldn't add the expense: This key is not valid any more…", so a problem is never a blank
   notification.

Then in the Automation tab: **App** → pick the app → **Is Closed** → Run Immediately, with
the actions **Text** "Swiggy" and **Run Shortcut** "Log expense" (input: that text). Repeat
per app. The presets are each space's "Everyone" plus its quick-action groups, so they follow
what owners set as shortcuts in the app.

Step-by-step, tap-by-tap instructions and troubleshooting: [docs/IPHONE_SHORTCUT_SETUP.md](docs/IPHONE_SHORTCUT_SETUP.md).

## AI apps (MCP)

`/mcp` is an MCP server (Streamable HTTP, stateless, JSON replies) so Claude and ChatGPT,
including their phone apps, can read spaces and add expenses as you. It signs in with a
personal key, sent as `Authorization: Bearer et_…` or as the last part of the address
(`/mcp/et_…`) for connector forms without a header field; there the connector is added with
"No authentication". Settings shows the **connector address** next to a new key.

- Code: `server/mcp.ts` (tools), `netlify/functions/mcp.ts` (function at `/mcp` and `/mcp/*`).
  Tools call the API in-process with the key, so they have exactly a key's scope: no deleting,
  merging or key management.
- Tools: `list_people` (paginated registered names/app IDs), `create_space` (monthly or one-time, registered members, caller as owner), `list_spaces`, `get_space`, `list_expenses` (month, payer, person and text filters;
  paging; exact counts from the database), `list_payments`, `get_balances`, `add_expense`,
  `add_expenses`, `edit_expense` (needs the version read), `record_payment`. They take names
  ("me", people, groups; `group:`/`person:` when a name is both), rupees to the paisa (more
  decimals are refused, not rounded) and dates like "yesterday", and reply in plain text.
- `npm run dev:local` serves `/mcp` too. Try it with `npx @modelcontextprotocol/inspector`.
- Setup for users: [docs/AI_APPS_SETUP.md](docs/AI_APPS_SETUP.md). Design and the OAuth next
  step: [docs/MCP_SERVER_PLAN.md](docs/MCP_SERVER_PLAN.md).

The **People** sidebar section lets signed-in users browse and search the name-only platform directory, select people across pages, and continue new-space onboarding with them selected. The UI and MCP use the same paginated API. Space creation through MCP accepts names or directory IDs and an optional request ID for safe retries; it does not invite new people by email. See [platform people and MCP space creation](docs/PLATFORM_PEOPLE_MCP.md) for examples and verification scenarios.

## Changing the database

Add a new numbered file such as `netlify/database/migrations/0004_add_categories.sql` (0003 is `api_tokens`).
Never edit a migration that has already been deployed. Deploy previews get their own copy
of the database, seeded from production, so a migration can be tried there first.
