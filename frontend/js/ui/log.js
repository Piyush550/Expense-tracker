// The month's expense list, with edit/delete and CSV downloads.
import { esc, money, monthLabel, dateLabel } from "../core/format.js";
import { S, allReady, monthExpenses, groupMatching, mName } from "../state.js";
import * as db from "../api/database.js";
import { $, chip, who, toast } from "./dom.js";
import { openForm } from "./expense-form.js";
import { downloadCsv } from "./export.js";

export function renderLog() {
  var el = $("log");
  var ms = monthExpenses();
  var all = S.users.length;
  var head = '<div class="sechead"><h2>Expenses in ' + esc(monthLabel(S.month)) + '</h2><div class="headbtns">' +
    '<button type="button" class="btn small" data-act="csv-month">Download month (CSV)</button>' +
    '<button type="button" class="btn small" data-act="csv-all">Download everything (CSV)</button>' +
    '<button type="button" class="btn primary" data-act="add"' + (allReady() ? "" : " disabled") + '>+ Add expense</button></div></div>';
  if (!allReady()) { el.innerHTML = head + '<div class="card empty">Loading the ledger…</div>'; return; }
  if (!ms.length) { el.innerHTML = head + '<div class="card empty">Nothing logged for ' + esc(monthLabel(S.month)) + ". Whoever paid for the last outing can add it with the button above.</div>"; return; }
  var rows = ms.map(function (e) {
    var ppl = (e.people || []);
    var everyone = all > 1 && ppl.length === all && S.users.every(function (u) { return ppl.indexOf(u.id) >= 0; });
    var grp = everyone ? null : groupMatching(ppl);
    var withHtml = everyone ? '<span class="muted">Everyone (' + all + ")</span>" :
      grp ? '<span class="muted" title="' + esc(ppl.map(mName).join(", ")) + '">' + esc(grp.name) + " (" + ppl.length + ")</span>" :
      ppl.map(function (id) { return '<span title="' + esc(mName(id)) + '">' + chip(id, true) + "</span>"; }).join("");
    var each = ppl.length ? Math.round(e.paise / ppl.length) : 0;
    var act = '<button type="button" class="btn small" data-act="edit" data-id="' + esc(e.id) + '">Edit</button>' +
      '<button type="button" class="btn small danger' + (S.delId === e.id ? " on" : "") + '" data-act="del" data-id="' + esc(e.id) + '">' + (S.delId === e.id ? "Confirm delete" : "Delete") + "</button>";
    return '<li class="x"><div class="x-date">' + esc(dateLabel(e.date)) + '</div><div class="x-main"><strong>' + esc(e.name) + "</strong>" +
      (e.remarks ? '<span class="rem">' + esc(e.remarks) + "</span>" : "") + '</div><div class="x-who"><span class="lbl">Paid by</span>' + who(e.payer) +
      '</div><div class="x-with"><span class="lbl">Split</span>' + withHtml + '</div><div class="x-amt amt">' + money(e.paise) +
      "<small>" + money(each) + " each</small></div>" + '<div class="x-act">' + act + "</div></li>";
  }).join("");
  el.innerHTML = head + '<div class="card" style="padding:0"><ul class="log">' + rows + "</ul></div>";
}

export var actions = {
  add: function () { openForm(null); },
  edit: function (b) { openForm(b.getAttribute("data-id")); },
  // First click arms the delete, second click confirms it.
  del: function (b) {
    var id = b.getAttribute("data-id");
    if (S.delId !== id) { S.delId = id; renderLog(); return; }
    S.delId = null;
    db.deleteExpense(id).catch(function (e) { toast(db.dbErrorMessage(e)); });
    toast("Expense deleted");
  },
  "csv-month": function () { downloadCsv(false); },
  "csv-all": function () { downloadCsv(true); }
};
