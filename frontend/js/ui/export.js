// Copy-to-clipboard summary and CSV downloads.
import { money, monthLabel, csvCell } from "../core/format.js";
import { S, monthExpenses, currentCalc, tKey, mName } from "../state.js";
import { toast } from "./dom.js";

function copyText(text) {
  function fallback() {
    var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta); toast(ok ? "Summary copied" : "Could not copy. Select the payments and copy them by hand.");
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast("Summary copied"); }, fallback);
  } else fallback();
}

export function copySummary() {
  var ms = monthExpenses(), calc = currentCalc(), done = S.settled[S.month] || {};
  var total = ms.reduce(function (a, e) { return a + e.paise; }, 0);
  var lines = ["Expense Tracker – " + monthLabel(S.month), "Total spent: " + money(total), ""];
  if (!calc.transfers.length) lines.push("Everyone is square.");
  else { lines.push("Settle up:"); calc.transfers.forEach(function (t) { lines.push(mName(t.from) + " pays " + mName(t.to) + " " + money(t.paise) + (done[tKey(t)] ? " (paid)" : "")); }); }
  copyText(lines.join("\n"));
}

export function downloadCsv(all) {
  var list = (all ? S.expenses.slice() : monthExpenses().slice())
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0); });
  var rows = [["Date", "Expense", "Amount (INR)", "Paid by", "People involved", "Remarks"]];
  list.forEach(function (e) {
    rows.push([e.date, e.name, (e.paise / 100).toFixed(2), mName(e.payer), (e.people || []).map(mName).join("; "), e.remarks || ""]);
  });
  var text = "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
  var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "expense-tracker-" + (all ? "all" : S.month) + ".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  toast("Download started");
}
