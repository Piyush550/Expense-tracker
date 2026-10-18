# Expense Tracker

A shared expense tracker. Everyone signs up with a verified email, logs what they paid and who shared it,
and the app works out the fewest payments to settle each month.

```
frontend/              static site, deployed on Netlify (no build step)
  index.html
  css/styles.css
  js/
    main.js            entry point: routes clicks and form submits
    config.js          Firebase web config (paste the apiKey here)
    session.js         Firebase startup, signed-in user, live data → state
    state.js           app state and selectors
    api/               the only code that talks to Firebase
      firebase.js        SDK setup
      auth.js            sign up / sign in / verification / password reset
      database.js        reads and writes to the Realtime Database
    core/              pure logic, no DOM or Firebase
      settlement.js      equal splits and minimum settle-up payments
      format.js          money, dates, CSV, escaping
    ui/                one module per section of the page
backend/               Firebase: database rules and CLI config (see backend/README.md)
netlify.toml           tells Netlify to publish frontend/
```

## Running locally

The frontend uses ES modules, so it needs to be served over http rather than opened as a file:

```bash
cd frontend
python -m http.server 8000
```

Then open http://localhost:8000.

## Deploying

- **Frontend:** Netlify publishes `frontend/`, as set in `netlify.toml`. For a manual deploy, drag the `frontend` folder onto the Netlify Deploys page.
- **Backend:** publish `backend/database.rules.json`. See [backend/README.md](backend/README.md).
