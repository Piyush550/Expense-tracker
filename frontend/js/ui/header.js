// Title, theme toggle, month picker and the month's headline numbers.
import { esc, money, monthLabel, shiftMonth } from "../core/format.js";
import { S, monthExpenses, monthList, currentCalc } from "../state.js";
import { $ } from "./dom.js";
import { themeButton } from "./theme.js";
import { render } from "./render.js";

export function renderHead() {
  var ready = S.phase === "ready";
  var tools = themeButton(), stats = "";
  var n = S.users.length;
  if (ready) {
    var ms = monthExpenses(), calc = currentCalc();
    var total = ms.reduce(function (a, e) { return a + (e.paise || 0); }, 0);
    var opts = monthList().map(function (m) {
      return '<option value="' + m + '"' + (m === S.month ? " selected" : "") + ">" + esc(monthLabel(m)) + "</option>";
    }).join("");
    tools += '<div class="monthnav"><button type="button" data-act="prev" aria-label="Previous month">‹</button>' +
      '<select id="monthSel" aria-label="Month">' + opts + '</select>' +
      '<button type="button" data-act="next" aria-label="Next month">›</button></div>';
    stats = '<dl class="stats" style="margin-top:18px"><div><dt>Spent in ' + esc(monthLabel(S.month)) + "</dt><dd>" + money(total) + "</dd></div>" +
      "<div><dt>Expenses</dt><dd>" + ms.length + "</dd></div>" +
      "<div><dt>Payments to settle</dt><dd>" + calc.transfers.length + "</dd></div></dl>";
  }
  $("head").innerHTML =
    '<div class="titlebar"><div><h1>Expense Tracker</h1><p class="sub">' +
    (ready && n ? n + (n === 1 ? " member" : " members") + ", equal splits, amounts in ₹" : "Shared expense tracker for the group") +
    '</p></div><div class="tools">' + tools + "</div></div>" + stats;
}

export function setMonth(ym) { S.month = ym; render(); }

export var actions = {
  prev: function () { setMonth(shiftMonth(S.month, -1)); },
  next: function () { setMonth(shiftMonth(S.month, 1)); }
};
