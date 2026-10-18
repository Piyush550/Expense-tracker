// Light / dark theme (light is the default). index.html applies the saved choice before first paint.
import { renderHead } from "./header.js";

function currentTheme() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
function setTheme(t) {
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("expense-tracker-theme", t); } catch (e) { /* ignore */ }
  renderHead();
}
export function themeButton() {
  var dark = currentTheme() === "dark";
  var icon = dark
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  return '<button type="button" class="themebtn" data-act="theme" aria-label="Switch to ' + (dark ? "light" : "dark") + ' theme" title="Switch to ' + (dark ? "light" : "dark") + ' theme">' + icon + "<span>" + (dark ? "Light" : "Dark") + "</span></button>";
}

export var actions = {
  theme: function () { setTheme(currentTheme() === "dark" ? "light" : "dark"); }
};
