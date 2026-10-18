// Groups: saved sets of people for quick picking in the expense form.
import { esc } from "../core/format.js";
import { S, uid, allReady, findIn, mName, groupPeople } from "../state.js";
import * as db from "../api/database.js";
import { $, chip, toast } from "./dom.js";

export function renderGroups() {
  var el = $("groups");
  var head = '<div class="sechead"><h2>Groups</h2>' + (S.groupEdit ? "" : '<button type="button" class="btn small" data-act="group-new"' + (allReady() ? "" : " disabled") + ">+ New group</button>") + "</div>";
  if (!allReady()) { el.innerHTML = ""; return; }
  if (S.groupEdit) {
    var g = S.groupEdit === "new" ? null : findIn(S.groups, S.groupEdit);
    var sel = g ? g.members : [];
    var picks = S.users.map(function (u) {
      return '<label class="pick" title="' + esc(u.email) + '"><input type="checkbox" name="gperson" value="' + esc(u.id) + '"' + (sel.indexOf(u.id) >= 0 ? " checked" : "") + ">" + chip(u.id, true) + "<span>" + esc(u.name) + "</span></label>";
    }).join("");
    el.innerHTML = head + '<form class="card formcard" id="groupForm" novalidate><div class="sechead"><h2>' + (g ? "Edit group" : "New group") + "</h2></div>" +
      '<div class="field" style="max-width:360px"><label for="g-name">Group name</label><input type="text" id="g-name" maxlength="40" placeholder="Boys Flat, Office, Goa trip…" value="' + esc(g ? g.name : "") + '" autocomplete="off"></div>' +
      '<div class="field" style="margin-top:14px"><div class="legend">People in this group</div><div class="picks" role="group" aria-label="People in this group">' + picks + "</div></div>" +
      '<div class="formfoot"><button type="submit" class="btn primary">' + (g ? "Save group" : "Create group") + '</button><button type="button" class="btn" data-act="group-cancel">Cancel</button><span class="err" id="g-err"></span></div></form>';
    return;
  }
  if (!S.groups.length) {
    el.innerHTML = head + '<div class="card muted">No groups yet. Make one, like "Boys Flat", to pick all its people in one click when adding an expense.</div>';
    return;
  }
  var rows = S.groups.map(function (g) {
    var gp = groupPeople(g);
    var ppl = gp.length ? gp.map(function (id) { return '<span class="who" style="margin-right:10px">' + chip(id, true) + "<span>" + esc(mName(id)) + "</span></span>"; }).join("") : '<span class="muted">Nobody</span>';
    var del = S.groupDelId === g.id;
    return '<li class="grouprow"><strong>' + esc(g.name) + '</strong><div class="x-with">' + ppl + '</div><div class="x-act">' +
      '<button type="button" class="btn small" data-act="group-edit" data-id="' + esc(g.id) + '">Edit</button>' +
      '<button type="button" class="btn small danger' + (del ? " on" : "") + '" data-act="group-del" data-id="' + esc(g.id) + '">' + (del ? "Confirm delete" : "Delete") + "</button></div></li>";
  }).join("");
  el.innerHTML = head + '<div class="card" style="padding:0"><ul class="grouplist">' + rows + "</ul></div>" +
    '<p class="note">Groups are shortcuts for the expense form. Anyone can edit them, and changing a group does not change past expenses.</p>';
}

function openGroupForm(id) {
  S.groupEdit = id || "new"; S.groupDelId = null; renderGroups();
  var f = $("groupForm"); if (f) { f.scrollIntoView({ block: "nearest" }); $("g-name").focus(); }
}

function saveGroup() {
  var name = $("g-name").value.trim().slice(0, 40), err = $("g-err");
  var ids = Array.prototype.slice.call(document.querySelectorAll("#groupForm input[name=gperson]:checked")).map(function (i) { return i.value; });
  var editId = S.groupEdit === "new" ? null : S.groupEdit;
  if (!name) { err.textContent = "Give the group a name."; $("g-name").focus(); return; }
  if (S.groups.some(function (g) { return g.id !== editId && g.name.toLowerCase() === name.toLowerCase(); })) { err.textContent = "There is already a group with this name."; return; }
  if (ids.length < 2) { err.textContent = "Pick at least two people."; return; }
  var old = editId ? findIn(S.groups, editId) : null;
  var id = editId || db.newKey("groups");
  var mm = {}; ids.forEach(function (p) { mm[p] = true; });
  var now = Date.now();
  db.saveGroup(id, {
    name: name, members: mm,
    createdAt: old && old.createdAt ? old.createdAt : now, createdBy: old && old.createdBy ? old.createdBy : uid(),
    updatedAt: now, updatedBy: uid()
  }).catch(function (e) { toast(db.dbErrorMessage(e)); });
  S.groupEdit = null; renderGroups(); toast(editId ? "Group saved" : "Group created");
}

export var actions = {
  "group-new": function () { openGroupForm(null); },
  "group-edit": function (b) { openGroupForm(b.getAttribute("data-id")); },
  "group-cancel": function () { S.groupEdit = null; renderGroups(); },
  // First click arms the delete, second click confirms it.
  "group-del": function (b) {
    var id = b.getAttribute("data-id");
    if (S.groupDelId !== id) { S.groupDelId = id; renderGroups(); return; }
    S.groupDelId = null;
    db.deleteGroup(id).catch(function (e) { toast(db.dbErrorMessage(e)); });
    toast("Group deleted");
  }
};

export var forms = { groupForm: saveGroup };
