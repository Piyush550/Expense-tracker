// All reads and writes to the Realtime Database. Data model: backend/README.md.
import { fb } from "./firebase.js";

function ref(path) { return fb.root.child(path); }

// Raw snapshot value → plain objects the UI works with.
var normalize = {
  users: function (v) {
    return Object.keys(v).map(function (id) {
      var x = v[id] || {};
      return { id: id, name: String(x.name || "Unnamed"), email: String(x.email || ""), legacyDone: !!x.legacyDone };
    });
  },
  members: function (v) {
    return Object.keys(v).map(function (id) { var x = v[id] || {}; return { id: id, name: String(x.name || "Unnamed"), claimedBy: x.claimedBy || null }; });
  },
  expenses: function (v) {
    return Object.keys(v).map(function (id) {
      var x = v[id] || {};
      return { id: id, date: x.date, name: x.name, paise: x.paise, payer: x.payer, people: Object.keys(x.people || {}), remarks: x.remarks || "", createdAt: x.createdAt || 0, createdBy: x.createdBy || "" };
    });
  },
  groups: function (v) {
    return Object.keys(v).map(function (id) {
      var x = v[id] || {};
      return { id: id, name: String(x.name || "Unnamed group"), members: Object.keys(x.members || {}), createdAt: x.createdAt || 0, createdBy: x.createdBy || "" };
    });
  },
  settled: function (v) { return v; }
};

// Live updates for every collection: onData(name, value). Returns an unsubscribe function.
export function subscribe(onData, onError) {
  var refs = Object.keys(normalize).map(function (name) {
    var r = ref(name);
    r.on("value", function (snap) { onData(name, normalize[name](snap.val() || {})); }, onError);
    return r;
  });
  return function () { refs.forEach(function (r) { r.off(); }); };
}

export function watchConnection(cb) {
  fb.db.ref(".info/connected").on("value", function (s) { cb(s.val() === true); });
}

// First verified sign-in creates the profile that puts this person in everyone's expense form.
export function ensureProfile(u) {
  var r = ref("users/" + u.uid);
  return r.once("value").then(function (snap) {
    if (snap.exists()) return snap.child("email").val() === u.email ? null : r.child("email").set(u.email);
    var name = String(u.displayName || u.email.split("@")[0] || "Me").trim().slice(0, 24);
    return r.set({ name: name, email: u.email, createdAt: Date.now() });
  });
}

export function setUserName(uid, name) { return ref("users/" + uid + "/name").set(name); }
export function markLegacyDone(uid) { return ref("users/" + uid + "/legacyDone").set(true); }

export function newKey(collection) { return ref(collection).push().key; }
export function saveExpense(id, data) { return ref("expenses/" + id).set(data); }
export function deleteExpense(id) { return ref("expenses/" + id).remove(); }

export function setPaid(month, key, on) {
  var r = ref("settled/" + month + "/" + key);
  return on ? r.set(true) : r.remove();
}

export function saveGroup(id, data) { return ref("groups/" + id).set(data); }
export function deleteGroup(id) { return ref("groups/" + id).remove(); }

// Move every past expense and Paid tick from an old-group name to an account, in one atomic update.
export function claimLegacy(oldId, newId, expenses, settled) {
  var up = {};
  expenses.forEach(function (e) {
    if (e.payer === oldId) up["expenses/" + e.id + "/payer"] = newId;
    if (e.people.indexOf(oldId) >= 0) { up["expenses/" + e.id + "/people/" + oldId] = null; up["expenses/" + e.id + "/people/" + newId] = true; }
  });
  Object.keys(settled).forEach(function (m) {
    Object.keys(settled[m] || {}).forEach(function (k) {
      var p = k.split("_");
      if (p.length !== 3 || (p[0] !== oldId && p[1] !== oldId)) return;
      up["settled/" + m + "/" + k] = null;
      up["settled/" + m + "/" + (p[0] === oldId ? newId : p[0]) + "_" + (p[1] === oldId ? newId : p[1]) + "_" + p[2]] = true;
    });
  });
  up["members/" + oldId + "/claimedBy"] = newId;
  up["users/" + newId + "/legacyDone"] = true;
  return fb.root.update(up);
}

export function dbErrorMessage(e) {
  var c = e && (e.code || e.message || "");
  if (/permission/i.test(c)) return "The database refused the change. Check that the rules from backend/database.rules.json are published.";
  return "Could not save. Check your connection and try again.";
}

export function loadErrorMessage(e) {
  return /permission/i.test((e && (e.code || e.message)) || "")
    ? "The database refused to share its data. Publish the rules from backend/database.rules.json under Realtime Database → Rules in the Firebase console."
    : "Could not load the ledger right now. Reload the page to try again.";
}
