# Backend (Firebase)

The app has no server of its own. Firebase provides:

- **Authentication**: email/password accounts with email verification.
- **Realtime Database**: all data, under the `ledger` node.

This folder holds the database security rules and the Firebase CLI config to deploy them.

## Data model

```
ledger/
  users/{uid}        { name, email, createdAt, legacyDone? }   one per verified account
  expenses/{id}      { date, name, paise, payer, people: {uid: true}, remarks,
                       createdAt, createdBy, updatedAt, updatedBy }
  settled/{YYYY-MM}/{from_to_paise}: true                       "Paid" ticks
  groups/{id}        { name, members: {uid: true}, createdAt, createdBy, updatedAt, updatedBy }
  members/{id}       { name, order, claimedBy? }                names from the old fixed group
```

Money is stored as integer paise.

## Rules

[`database.rules.json`](database.rules.json) only lets signed-in users with a verified email read or write.
Each person can write only their own `users/{uid}` profile.

## Deploying the rules

**Option A: Firebase console.** Go to Realtime Database → Rules, paste the contents of `database.rules.json`, and click Publish.

**Option B: Firebase CLI**, run from this folder:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only database
```

## One-time console setup

- Authentication → Sign-in method: enable **Email/Password**.
- Authentication → Settings → Authorized domains: add the Netlify domain.
