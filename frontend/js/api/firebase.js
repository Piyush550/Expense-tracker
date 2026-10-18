// Firebase services, set up once by initFirebase(). Uses the compat SDK loaded by index.html.
export const fb = { auth: null, db: null, root: null };

export function isConfigured(cfg) {
  return !!(cfg.apiKey && !/PASTE_YOUR/.test(cfg.apiKey) && cfg.databaseURL);
}

export function sdkLoaded() {
  return typeof firebase !== "undefined" && !!firebase.auth && !!firebase.database;
}

export function initFirebase(cfg) {
  firebase.initializeApp(cfg);
  fb.db = firebase.database();
  fb.root = fb.db.ref("ledger");
  fb.auth = firebase.auth();
}
