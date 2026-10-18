// Entry point: routes clicks and form submits to the UI modules, then starts the app.
import { S } from "./state.js";
import { render } from "./ui/render.js";
import { start } from "./session.js";
import * as theme from "./ui/theme.js";
import * as header from "./ui/header.js";
import * as banner from "./ui/banner.js";
import * as authUi from "./ui/auth.js";
import * as settle from "./ui/settle.js";
import * as log from "./ui/log.js";
import * as expenseForm from "./ui/expense-form.js";
import * as groups from "./ui/groups.js";
import * as account from "./ui/account.js";

// data-act="name" on a button → actions[name](button)
var actions = Object.assign({}, theme.actions, header.actions, banner.actions, authUi.actions, settle.actions,
  log.actions, expenseForm.actions, groups.actions, account.actions);
// <form id="name"> → forms[name](form)
var forms = Object.assign({}, authUi.forms, expenseForm.forms, groups.forms, account.forms);

// Any click other than the confirming one cancels an armed "Confirm …" button.
function disarm(act) {
  if (act !== "del" && S.delId) { S.delId = null; log.renderLog(); }
  if (act !== "claim" && S.claimId) { S.claimId = null; banner.renderBanner(); }
  if (act !== "group-del" && S.groupDelId) { S.groupDelId = null; groups.renderGroups(); }
}

document.addEventListener("click", function (ev) {
  var b = ev.target.closest("[data-act]");
  var act = b ? b.getAttribute("data-act") : null;
  disarm(act);
  if (act && actions[act]) actions[act](b);
});
document.addEventListener("change", function (ev) {
  if (ev.target.id === "monthSel") header.setMonth(ev.target.value);
});
document.addEventListener("input", function (ev) {
  if (ev.target.closest && ev.target.closest("#expForm")) expenseForm.updateSplitNote();
});
document.addEventListener("submit", function (ev) {
  ev.preventDefault();
  var handler = forms[ev.target.id];
  if (handler) handler(ev.target);
});
// Coming back from the verification email in another tab: pick it up without a click.
window.addEventListener("focus", function () { if (S.phase === "unverified") authUi.checkVerified(true); });

render();
start();
