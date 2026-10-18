// "Signed in as …" line, change-name form and sign out.
import { esc } from "../core/format.js";
import { S, me, uid } from "../state.js";
import * as db from "../api/database.js";
import * as auth from "../api/auth.js";
import { $, who, toast } from "./dom.js";

export function renderAccount() {
  var el = $("account"), p = me();
  if (!p) { el.innerHTML = ""; return; }
  if (S.nameOpen) {
    el.innerHTML = '<form class="card" id="nameForm" novalidate><div class="sechead"><h2>Your name</h2></div>' +
      '<div class="field" style="max-width:320px"><label for="n-name">Shown to everyone on expenses</label><input type="text" id="n-name" maxlength="24" value="' + esc(p.name) + '" autocomplete="name"></div>' +
      '<div class="formfoot"><button type="submit" class="btn primary">Save name</button><button type="button" class="btn" data-act="name-close">Cancel</button><span class="err" id="n-err"></span></div></form>';
    return;
  }
  el.innerHTML = '<div class="acct"><span class="muted">Signed in as</span>' + who(p.id) + '<span class="muted">' + esc(S.user.email) + "</span>" +
    '<span class="acct-links"><button type="button" class="linkbtn" data-act="name-open">Change my name</button><button type="button" class="linkbtn" data-act="signout">Sign out</button></span></div>';
}

function saveName() {
  var v = $("n-name").value.trim().slice(0, 24), err = $("n-err");
  if (!v) { err.textContent = "Enter a name."; return; }
  db.setUserName(uid(), v).catch(function (e) { toast(db.dbErrorMessage(e)); });
  auth.updateDisplayName(v).catch(function () { /* the database copy is what others see */ });
  S.nameOpen = false; renderAccount(); toast("Name updated");
}

export var actions = {
  "name-open": function () { S.nameOpen = true; renderAccount(); $("n-name").focus(); },
  "name-close": function () { S.nameOpen = false; renderAccount(); }
};

export var forms = { nameForm: saveName };
