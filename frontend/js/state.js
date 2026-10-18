// App state plus read-only selectors over it.
import { computeMonth } from "./core/settlement.js";
import { ymNow } from "./core/format.js";

// phase: "loading" → "signedOut" | "unverified" | "ready"
export var S = {
  user: null, phase: "loading", authMode: "signin", authKey: "", busy: false,
  users: [], legacy: [], expenses: [], settled: {}, groups: [],
  ready: { u: false, l: false, e: false, s: false, g: false },
  month: ymNow(), editing: null, delId: null, claimId: null, nameOpen: false, groupEdit: null, groupDelId: null,
  online: null, err: "", setup: false
};

export function clearData() {
  S.users = []; S.legacy = []; S.expenses = []; S.settled = {}; S.groups = [];
  S.ready = { u: false, l: false, e: false, s: false, g: false };
  S.groupEdit = null; S.groupDelId = null;
  S.err = "";
}

export function allReady() { return S.ready.u && S.ready.l && S.ready.e && S.ready.s && S.ready.g; }

// People are verified accounts (S.users). S.legacy holds names from the old fixed group,
// kept so past expenses still show a name until someone claims them.
export function uid() { return S.user ? S.user.uid : ""; }
export function findIn(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
export function userById(id) { return findIn(S.users, id); }
export function me() { return userById(uid()); }
export function person(id) { return userById(id) || findIn(S.legacy, id); }
export function mName(id) { var p = person(id); return p ? p.name : "Former member"; }
export function unclaimedLegacy() { return S.legacy.filter(function (m) { return !m.claimedBy; }); }
export function byName(a, b) { var x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1); }

export function monthExpenses() {
  return S.expenses.filter(function (e) { return (e.date || "").slice(0, 7) === S.month; })
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0); });
}
export function monthList() {
  var set = {}; set[ymNow()] = 1; set[S.month] = 1;
  S.expenses.forEach(function (e) { if (e.date) set[e.date.slice(0, 7)] = 1; });
  return Object.keys(set).sort().reverse();
}
export function currentCalc() { return computeMonth(monthExpenses(), []); }
export function tKey(t) { return t.from + "_" + t.to + "_" + t.paise; }

// Group members who still have an account, so a group never selects someone the form cannot show.
export function groupPeople(g) { return g.members.filter(function (id) { return !!userById(id); }); }
export function sameSet(a, b) { return a.length === b.length && a.every(function (id) { return b.indexOf(id) >= 0; }); }
export function groupMatching(ids) {
  for (var i = 0; i < S.groups.length; i++) { var gp = groupPeople(S.groups[i]); if (gp.length > 1 && sameSet(gp, ids)) return S.groups[i]; }
  return null;
}
