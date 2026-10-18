// Connects to Firebase, follows the signed-in user and keeps state in sync with the database.
import { FIREBASE_CONFIG } from "./config.js";
import { isConfigured, sdkLoaded, initFirebase } from "./api/firebase.js";
import * as auth from "./api/auth.js";
import * as db from "./api/database.js";
import { S, clearData, byName } from "./state.js";
import { toast } from "./ui/dom.js";
import { render } from "./ui/render.js";
import { renderBanner } from "./ui/banner.js";
import { checkVerified } from "./ui/auth.js";

var READY_KEY = { users: "u", members: "l", expenses: "e", settled: "s", groups: "g" };
var unsubscribe = null;

function onData(name, value) {
  if (name === "users") S.users = value.sort(byName);
  else if (name === "members") S.legacy = value;
  else if (name === "expenses") S.expenses = value;
  else if (name === "groups") S.groups = value.sort(byName);
  else if (name === "settled") S.settled = value;
  S.ready[READY_KEY[name]] = true;
  render();
}

function onLoadError(e) {
  S.err = db.loadErrorMessage(e);
  S.ready = { u: true, l: true, e: true, s: true, g: true }; render();
}

export function onUser(u) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  clearData();
  S.user = u || null; S.nameOpen = false; S.claimId = null; S.busy = false;
  if (!u) S.phase = "signedOut";
  else if (!u.emailVerified) S.phase = "unverified";
  else {
    S.phase = "ready";
    unsubscribe = db.subscribe(onData, onLoadError);
    db.ensureProfile(u).catch(function (e) { toast(db.dbErrorMessage(e)); });
  }
  render();
  // The cached user can be stale if the link was opened since the last visit.
  if (u && !u.emailVerified) checkVerified(true);
}

export function start() {
  if (!isConfigured(FIREBASE_CONFIG)) { S.setup = true; render(); return; }
  if (!sdkLoaded()) { S.err = "Could not load Firebase. Check your internet connection and reload."; render(); return; }
  try {
    initFirebase(FIREBASE_CONFIG);
    db.watchConnection(function (online) { S.online = online; renderBanner(); });
    auth.onAuthChange(onUser);
  } catch (e) {
    S.err = "Could not connect to Firebase. Check frontend/js/config.js."; render();
  }
}
