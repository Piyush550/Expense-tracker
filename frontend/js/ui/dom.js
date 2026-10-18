// Small DOM helpers and the person chip used across the UI.
import { esc } from "../core/format.js";
import { person, mName } from "../state.js";

export var $ = function (id) { return document.getElementById(id); };
export function val(id) { var el = $(id); return el ? el.value : ""; }

var toastTimer = null;
export function toast(msg) {
  var t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
}

var HUES = [222, 18, 152, 292, 42, 188, 340, 96, 262, 8, 72, 322];
function hueFor(id) {
  var h = 0; id = String(id || "");
  for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return HUES[Math.abs(h) % HUES.length];
}
export function chip(id, small) {
  var p = person(id);
  var nm = p ? p.name.trim().slice(0, 2) : "?";
  return '<span class="chip' + (small ? " sm" : "") + '" style="--h:' + hueFor(id) + '" aria-hidden="true">' + esc(nm) + "</span>";
}
export function who(id) { return '<span class="who">' + chip(id) + "<strong>" + esc(mName(id)) + "</strong></span>"; }
