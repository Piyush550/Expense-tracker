// "Who paid and who used": per-person totals for the month.
import { esc, money, monthLabel } from "../core/format.js";
import { S, allReady, currentCalc, mName, byName } from "../state.js";
import { $, who } from "./dom.js";

export function renderBalances() {
  var el = $("balances");
  var head = '<div class="sechead"><h2>Who paid and who used</h2></div>';
  if (!allReady()) { el.innerHTML = head + '<div class="card muted">Loading…</div>'; return; }
  var calc = currentCalc();
  var ids = Object.keys(calc.net).map(function (id) { return { id: id, name: mName(id) }; }).sort(byName);
  if (!ids.length) { el.innerHTML = head + '<div class="card muted">Nobody has spent anything in ' + esc(monthLabel(S.month)) + " yet.</div>"; return; }
  var rows = ids.map(function (p) {
    var n = calc.net[p.id] || 0;
    var b = n > 0 ? '<span class="badge pos">gets ' + money(n) + "</span>" : n < 0 ? '<span class="badge neg">owes ' + money(-n) + "</span>" : '<span class="badge zero">square</span>';
    return "<tr><td>" + who(p.id) + '</td><td class="r amt">' + money(calc.paid[p.id] || 0) + '</td><td class="r amt">' + money(calc.share[p.id] || 0) + '</td><td class="r">' + b + "</td></tr>";
  }).join("");
  el.innerHTML = head + '<div class="card"><div class="tablewrap"><table><thead><tr><th>Person</th><th class="r">Paid out</th><th class="r">Their share</th><th class="r">Net</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
    '<p class="note">Paid out is what the person put down. Their share is their cut of every expense they were part of.</p></div>';
}
