// Top banner: setup guide, errors, offline notice, and the one-time "Were you in the old group?" card.
import { esc } from "../core/format.js";
import { S, allReady, me, uid, unclaimedLegacy, byName } from "../state.js";
import * as db from "../api/database.js";
import { $, chip, toast } from "./dom.js";

function setupGuide() {
  return '<div class="card"><h3 style="font-size:20px">Finish setting up sign-in</h3><p class="muted" style="margin:6px 0 0">Accounts use Firebase Authentication. Do this once in the Firebase console:</p>' +
    '<ol class="steps"><li>Authentication → Sign-in method: enable <strong>Email/Password</strong>.</li>' +
    "<li>Project settings → General → Your apps: add a Web app if there is none, and copy its <strong>apiKey</strong>.</li>" +
    "<li>Paste it into frontend/js/config.js where it says PASTE_YOUR_WEB_API_KEY_HERE.</li>" +
    "<li>Realtime Database → Rules: paste the contents of backend/database.rules.json and publish.</li></ol></div>";
}

export function renderBanner() {
  var h = "";
  if (S.setup) {
    h = setupGuide();
  } else if (S.err) {
    h = '<div class="banner warn">' + esc(S.err) + "</div>";
  } else if (S.phase !== "ready") {
    h = "";
  } else if (S.online === false && allReady()) {
    h = '<div class="banner">You are offline. Changes you make now will sync when the connection comes back.</div>';
  } else if (allReady() && me() && !me().legacyDone && unclaimedLegacy().length) {
    var btns = unclaimedLegacy().sort(byName).map(function (m) {
      var on = S.claimId === m.id;
      return '<button type="button" class="btn claimbtn' + (on ? " on" : "") + '" data-act="claim" data-id="' + esc(m.id) + '">' + chip(m.id, true) + "<span>" + (on ? "Yes, I am " : "") + esc(m.name) + "</span></button>";
    }).join("");
    h = '<div class="card"><h3 style="font-size:20px">Were you in the old group?</h3><p class="muted" style="margin:6px 0 0">This tracker used to have a fixed list of names. If one of them is you, pick it and every past expense under that name moves to your account.</p>' +
      '<div class="picks" style="margin:14px 0">' + btns + '</div><div class="formfoot" style="margin-top:0"><button type="button" class="btn" data-act="claim-skip">None of these, I am new</button></div></div>';
  }
  $("banner").innerHTML = h;
}

export var actions = {
  // First click arms the choice, second click confirms it.
  claim: function (b) {
    var id = b.getAttribute("data-id");
    if (S.claimId !== id) { S.claimId = id; renderBanner(); return; }
    S.claimId = null;
    db.claimLegacy(id, uid(), S.expenses, S.settled)
      .then(function () { toast("Past expenses moved to your account"); }, function (e) { toast(db.dbErrorMessage(e)); });
  },
  "claim-skip": function () {
    db.markLegacyDone(uid()).catch(function (e) { toast(db.dbErrorMessage(e)); });
  }
};
