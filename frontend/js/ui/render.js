// Redraws every section from state. Open forms are left alone so typing is not lost.
import { S } from "../state.js";
import { $ } from "./dom.js";
import { renderHead } from "./header.js";
import { renderBanner } from "./banner.js";
import { renderAuth } from "./auth.js";
import { renderSettle } from "./settle.js";
import { renderBalances } from "./balances.js";
import { renderLog } from "./log.js";
import { renderGroups } from "./groups.js";
import { renderAccount } from "./account.js";
import { closeForm } from "./expense-form.js";

export function render() {
  renderHead(); renderBanner(); renderAuth();
  var ready = S.phase === "ready";
  $("cols").hidden = !ready;
  if (!ready) {
    $("settle").innerHTML = $("balances").innerHTML = $("log").innerHTML = $("groups").innerHTML = $("account").innerHTML = "";
    if (S.editing !== null || !$("formWrap").hidden) closeForm();
    return;
  }
  renderSettle(); renderBalances(); renderLog();
  if (!S.groupEdit) renderGroups();
  if (!S.nameOpen) renderAccount();
}
