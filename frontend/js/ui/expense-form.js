// Add / edit expense form, including the group quick-pick buttons.
import { esc, money, parseAmount, todayStr, ymNow } from "../core/format.js";
import { S, uid, findIn, mName, groupPeople, sameSet } from "../state.js";
import * as db from "../api/database.js";
import { $, chip, toast } from "./dom.js";
import { render } from "./render.js";

export function openForm(id) {
  var e = id ? S.expenses.filter(function (x) { return x.id === id; })[0] : null;
  S.editing = e ? e.id : null;
  // Everyone with a verified account, plus any old-group names already on this expense.
  var list = S.users.slice();
  if (e) [e.payer].concat(e.people).forEach(function (pid) { if (pid && !findIn(list, pid)) list.push({ id: pid, name: mName(pid), email: "" }); });
  var payer = e ? e.payer : uid();
  var people = e ? e.people : S.users.map(function (u) { return u.id; });
  var defDate = e ? e.date : (S.month === ymNow() ? todayStr() : S.month + "-01");
  var payOpts = list.map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === payer ? " selected" : "") + ">" + esc(m.name) + (m.id === uid() ? " (you)" : "") + "</option>"; }).join("");
  var picks = list.map(function (m) {
    return '<label class="pick"' + (m.email ? ' title="' + esc(m.email) + '"' : "") + '><input type="checkbox" name="person" value="' + esc(m.id) + '"' + (people.indexOf(m.id) >= 0 ? " checked" : "") + ">" + chip(m.id, true) + "<span>" + esc(m.name) + "</span></label>";
  }).join("");
  var groupBtns = S.groups.length ? '<div class="groupbtns" role="group" aria-label="Pick a group"><span class="lbl">Groups</span>' + S.groups.map(function (g) {
    return '<button type="button" class="btn small" data-act="pick-group" data-id="' + esc(g.id) + '" title="' + esc(groupPeople(g).map(mName).join(", ")) + '">' + esc(g.name) + "</button>";
  }).join("") + "</div>" : "";
  var amtVal = e ? String(e.paise / 100) : "";
  var w = $("formWrap");
  w.innerHTML = '<form class="card formcard" id="expForm" novalidate><div class="sechead"><h2>' + (e ? "Edit expense" : "New expense") + "</h2></div>" +
    '<div class="formgrid">' +
    '<div class="field"><label for="f-date">Date</label><input type="date" id="f-date" value="' + esc(defDate) + '" required></div>' +
    '<div class="field name"><label for="f-name">Name of the expense</label><input type="text" id="f-name" maxlength="80" placeholder="Dinner at Social, cab to airport…" value="' + esc(e ? e.name : "") + '" autocomplete="off" required></div>' +
    '<div class="field"><label for="f-amt">Amount</label><div class="amtwrap"><span>₹</span><input type="text" id="f-amt" inputmode="decimal" placeholder="0" value="' + esc(amtVal) + '" autocomplete="off" required></div></div>' +
    '<div class="field"><label for="f-payer">Paid by</label><select id="f-payer">' + payOpts + "</select></div>" +
    '<div class="field full"><div class="legend">People involved <span class="quick">· <button type="button" class="linkbtn" data-act="pick-all">everyone</button> · <button type="button" class="linkbtn" data-act="pick-none">clear</button></span></div>' + groupBtns + '<div class="picks" role="group" aria-label="People involved">' + picks + "</div></div>" +
    '<div class="field full"><label for="f-rem">Remarks</label><textarea id="f-rem" rows="2" maxlength="200" placeholder="Optional. Who ordered extra, what the bill included…">' + esc(e ? e.remarks || "" : "") + "</textarea></div></div>" +
    '<div class="formfoot"><button type="submit" class="btn primary" id="f-save">' + (e ? "Save changes" : "Add expense") + '</button><button type="button" class="btn" data-act="form-cancel">Cancel</button><span class="grow" id="f-note"></span></div><div class="err" id="f-err" style="margin-top:8px"></div></form>';
  w.hidden = false; updateSplitNote();
  $("f-name").focus();
  w.scrollIntoView({ block: "nearest" });
}

export function closeForm() { S.editing = null; var w = $("formWrap"); w.hidden = true; w.innerHTML = ""; }

function personInputs() { return Array.prototype.slice.call(document.querySelectorAll("#formWrap input[name=person]")); }
function checkedPeople() { return personInputs().filter(function (i) { return i.checked; }).map(function (i) { return i.value; }); }

export function updateSplitNote() {
  var n = $("f-note"); if (!n) return;
  var sel = checkedPeople();
  // Highlight the group whose people are exactly the current selection.
  Array.prototype.forEach.call(document.querySelectorAll("#formWrap [data-act=pick-group]"), function (b) {
    var g = findIn(S.groups, b.getAttribute("data-id"));
    var on = !!g && sameSet(groupPeople(g), sel);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  var p = parseAmount($("f-amt").value), c = sel.length;
  if (!c) n.textContent = "Pick at least one person to split between.";
  else if (!p) n.textContent = c + (c === 1 ? " person" : " people") + " selected.";
  else n.textContent = "Split equally: about " + money(Math.round(p / c)) + " each between " + c + (c === 1 ? " person." : " people.");
}

function saveExpense() {
  var date = $("f-date").value, name = $("f-name").value.trim(), paise = parseAmount($("f-amt").value);
  var payer = $("f-payer").value, people = checkedPeople(), rem = $("f-rem").value.trim();
  var err = $("f-err");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err.textContent = "Choose the date of the expense."; return; }
  if (!name) { err.textContent = "Give the expense a name."; $("f-name").focus(); return; }
  if (!paise) { err.textContent = "Enter an amount above zero, like 1250 or 1250.50."; $("f-amt").focus(); return; }
  if (!people.length) { err.textContent = "Select at least one person who shared this expense."; return; }
  var old = S.editing ? S.expenses.filter(function (x) { return x.id === S.editing; })[0] : null;
  var id = S.editing || db.newKey("expenses");
  var now = Date.now();
  var pm = {}; people.forEach(function (p) { pm[p] = true; });
  var wasEdit = !!S.editing;
  S.month = date.slice(0, 7);
  db.saveExpense(id, {
    date: date, name: name, paise: paise, payer: payer, people: pm, remarks: rem,
    createdAt: old && old.createdAt ? old.createdAt : now, createdBy: old && old.createdBy ? old.createdBy : uid(),
    updatedAt: now, updatedBy: uid()
  }).catch(function (e) { toast(db.dbErrorMessage(e)); });
  closeForm(); render(); toast(wasEdit ? "Expense updated" : "Expense added");
}

export var actions = {
  "form-cancel": function () { closeForm(); },
  "pick-all": function () { personInputs().forEach(function (i) { i.checked = true; }); updateSplitNote(); },
  "pick-none": function () { personInputs().forEach(function (i) { i.checked = false; }); updateSplitNote(); },
  "pick-group": function (b) {
    var g = findIn(S.groups, b.getAttribute("data-id"));
    if (g) { var gp = groupPeople(g); personInputs().forEach(function (i) { i.checked = gp.indexOf(i.value) >= 0; }); }
    updateSplitNote();
  }
};

export var forms = { expForm: saveExpense };
