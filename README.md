# Expense Tracker

A shared expense tracker for groups: log who paid and who shared it, split equally, by exact
amounts, by percentage or by shares, and settle up with the fewest payments.

```
Browser (React + Vite)
  │  1. Sign in with Google or email/password (Firebase Authentication)
  │  2. fetch /api/... with "Authorization: Bearer <Firebase ID token>"
  ▼
Netlify Function  netlify/functions/api.ts  (Hono, served at /api/*)
  │  verifies the token, checks group membership, validates input,
  │  computes splits and balances (shared/)
  ▼
Netlify Database (Postgres)   schema: netlify/database/migrations/
```

Everything deploys as one Netlify site from one repo. Firebase is only used for sign-in.

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
  payments received. A group's balances always sum to zero. Balances run across all months:
  the month picker only filters the lists.
- **Settle up** (`shared/settlement.ts`): with *Simplify debts* on, the group gets the true
  minimum number of payments. It finds the most zero-sum sub-groups (exact up to 16 people
  with a balance, checked against brute force in the tests). With it off, each person pays
  back exactly who they owe.
- **Payments** are recorded as rows (`settlements`), not ticks, so editing an old expense can
  never silently undo a payment.

## Security model

The API is public on the internet. Security comes from the code:

1. Every `/api` request needs a Firebase ID token. `server/auth.ts` verifies its RS256
   signature against Google's keys, plus the issuer, audience, expiry and a verified email.
2. Every group route checks the caller is an active member. Outsiders get 404, so a group's
   existence is not revealed.
3. All input is validated with zod. Payer and participants must be members.
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

Then, in another terminal, add test accounts and sample data:

```bash
npm run seed:local
```

Open http://localhost:5173 and sign in as `asha@example.test` (password in
`scripts/seed-local.ts`). Google sign-in opens the emulator's fake account picker.

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
   DATABASE_URL='postgres://…' npm run import:firebase -- firebase-export.json --group-name "Flat 4B" --owner-email you@gmail.com --dry-run
   ```
4. Check the balances against the old app, then run it again without `--dry-run`.
   Running it twice is safe.

What the import does:
- Everything goes into one group, because the old app had a single shared ledger.
- Old "Paid" ticks become recorded payments.
- Names from the old fixed list that nobody claimed become members without an account.
  A group owner can link each one to a real person later (Members → *Link to…* or *This is me*).
- The old "groups" were only quick-pick shortcuts and are not carried over.
- Equal splits are recalculated, so an odd paisa may land on a different person than before.

## API

All routes are under `/api`, need `Authorization: Bearer <token>`, and return JSON.
Errors look like `{ "error": { "code", "message" } }`.

| Method | Path | |
|---|---|---|
| GET / PATCH | `/me` | your profile (`name`) |
| GET / POST | `/groups` | your groups with your balance / create (`name`, `memberEmails`) |
| GET / PATCH / DELETE | `/groups/:id` | details, members and active months / `name`, `simplifyDebts` / delete (owner, all settled) |
| POST | `/groups/:id/members` | add by `email`. Creates an invite if they have no account yet |
| PATCH / DELETE | `/groups/:id/members/:userId` | set `role` (owner) / leave or remove (balance must be 0) |
| POST | `/groups/:id/members/:userId/merge` | link a name without an account to `intoUserId` |
| GET | `/groups/:id/balances` | per-person totals and the suggested payments |
| GET / POST | `/groups/:id/expenses?month=YYYY-MM` | list / create (client-generated `id`) |
| PATCH / DELETE | `/expenses/:id` | edit (send `version`) / delete |
| GET / POST | `/groups/:id/settlements?month=YYYY-MM` | payments: list / record |
| DELETE | `/settlements/:id` | delete a payment |

## Changing the database

Add a new numbered file such as `netlify/database/migrations/0002_add_categories.sql`.
Never edit a migration that has already been deployed. Deploy previews get their own copy
of the database, seeded from production, so a migration can be tried there first.
