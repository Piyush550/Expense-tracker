// "Settle up": who pays whom this month, with Paid ticks.
import { esc, money, monthLabel } from "../core/format.js";
import { S, allReady, monthExpenses, currentCalc, tKey, mName } from "../state.js";
import * as db from "../api/database.js";
import { $, chip, who, toast } from "./dom.js";
import { copySummary } from "./export.js";

export function renderSettle() {
  var el = $("settle");
  var ms = monthExpenses();
  var head = '<div class="sechead"><h2>Settle up for ' + esc(monthLabel(S.month)) + "</h2>" +
    (ms.length ? '<button type="button" class="btn small" data-act="copy">Copy summary</button>' : "") + "</div>";
  if (!allReady()) { el.innerHTML = head + '<div class="card muted">Loading the ledger…</div>'; return; }
  if (!ms.length) { el.innerHTML = head + '<div class="card muted">No expenses in this month yet. Payments will appear here once someone adds one.</div>'; return; }
  var calc = currentCalc(), ts = calc.transfers;
  if (!ts.length) { el.innerHTML = head + '<div class="allsq">Everyone is square for this month.</div>'; return; }
  var done = S.settled[S.month] || {};
  var byFrom = {}, order = [];
  ts.forEach(function (t) { if (!byFrom[t.from]) { byFrom[t.from] = []; order.push(t.from); } byFrom[t.from].push(t); });
  var outstanding = 0;
  var cards = order.map(function (f) {
    var list = byFrom[f], total = 0;
    var rows = list.map(function (t) {
      var d = !!done[tKey(t)]; total += t.paise; if (!d) outstanding += t.paise;
      return '<li class="' + (d ? "done" : "") + '"><span class="who">pays ' + chip(t.to) + "<strong>" + esc(mName(t.to)) + '</strong></span><span class="amt">' + money(t.paise) + "</span>" +
        '<label class="paidbox"><input type="checkbox" data-act="paid" data-key="' + esc(tKey(t)) + '"' + (d ? " checked" : "") + "> Paid</label></li>";
    }).join("");
    return '<article class="card debtor"><header>' + who(f) + '<span><span class="muted">owes </span><span class="amt neg">' + money(total) + "</span></span></header><ul class=\"pays\">" + rows + "</ul></article>";
  }).join("");
  var foot = outstanding === 0
    ? '<div class="allsq" style="margin-top:12px">All payments for this month are marked paid.</div>'
    : '<p class="note">Fewest possible payments: ' + ts.length + ". Still to pay: " + money(outstanding) + ". Tick Paid after the money moves.</p>";
  el.innerHTML = head + cards + foot;
}

export var actions = {
  paid: function (b) { db.setPaid(S.month, b.getAttribute("data-key"), b.checked).catch(function (e) { toast(db.dbErrorMessage(e)); }); },
  copy: function () { copySummary(); }
};
