// Applies the saved theme before first paint (kept out of index.html so the CSP needs no inline
// scripts). "system", the default, follows the OS setting.
(function () {
  var pref = "system";
  try { pref = localStorage.getItem("expense-tracker-theme") || "system"; } catch (e) { /* storage blocked */ }
  var dark = pref === "dark" || (pref === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
