# Old Firebase Realtime Database (retired)

Up to v2.2 the app kept all data in the Firebase Realtime Database under `ledger/`.
v3 stores everything in Netlify Database (Postgres) and uses Firebase **only for sign-in**.

These files are kept for the cut-over and can be deleted once it is done.

## Cut-over

1. Firebase console → Realtime Database → Rules: publish
   [`database.rules.readonly.json`](database.rules.readonly.json) so nobody can add expenses
   to the old database while you move the data.
2. Realtime Database → Data → ⋮ → **Export JSON**. Keep the file out of git: it holds
   everyone's names, emails and expenses (`firebase-export*.json` is already git-ignored).
3. Import it into Netlify Database. See "Moving the old data" in the main [README](../README.md).
4. After everyone has used the new app for a while, delete the Realtime Database in the
   Firebase console. Authentication stays: it is what signs people in.

[`database.rules.json`](database.rules.json) is the old read/write policy, for reference only.
