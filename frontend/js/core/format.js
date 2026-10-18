// Pure helpers for dates, money (integer paise) and text.
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
export function pad2(n) { return String(n).padStart(2, "0"); }
export function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
export function ymNow() { return todayStr().slice(0, 7); }
export function monthLabel(ym) {
  var p = ym.split("-");
  return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}
export function shiftMonth(ym, delta) {
  var p = ym.split("-"); var d = new Date(+p[0], +p[1] - 1 + delta, 1);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}
export function dateLabel(s) {
  var p = (s || "").split("-"); if (p.length < 3) return s || "";
  return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
export function money(p) {
  var neg = p < 0; p = Math.abs(p);
  var r = Math.floor(p / 100), f = p % 100;
  return (neg ? "−" : "") + "₹" + r.toLocaleString("en-IN") + (f ? "." + pad2(f) : "");
}
export function parseAmount(v) {
  v = String(v || "").replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return 0;
  return Math.round(parseFloat(v) * 100);
}
export function csvCell(v) {
  v = String(v == null ? "" : v);
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
export function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
