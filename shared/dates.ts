// Calendar dates are plain "YYYY-MM-DD" strings and months are "YYYY-MM", in the user's local time.

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const pad2 = (n: number) => String(n).padStart(2, "0");

export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function currentMonth(d = new Date()): string {
  return todayIso(d).slice(0, 7);
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad2(d.getMonth() + 1)}`;
}

/** First day of the month and first day of the next month, for half-open range queries. */
export function monthRange(ym: string): { from: string; to: string } {
  return { from: `${ym}-01`, to: `${shiftMonth(ym, 1)}-01` };
}

export function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** "oct", "octo", "october" → 10. At least three letters, and only a beginning of the real name. */
function monthIndex(word: string): number | null {
  if (word.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(word));
  return i >= 0 ? i + 1 : null;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Reads what people type for a date, day first (Indian style):
 * "today", "yesterday", "21", "21 Oct", "Oct 21", "21/10", "21-10-26", "21.10.2026", "2026-10-21".
 * A bare day uses `month` (the month being viewed) or else today's month. A day and month
 * without a year use `month`'s year, or else the most recent such date (so "28 Dec" typed in
 * January means last December). Returns "YYYY-MM-DD", or null if it cannot be read.
 */
export function parseDateInput(text: string, ctx: { today: string; month?: string | null }): string | null {
  const s = text.trim().toLowerCase().replace(/,/g, " ").replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/\s+/g, " ");
  if (!s) return null;
  if (["today", "tod", "now"].includes(s)) return ctx.today;
  if (["yesterday", "yest", "yday"].includes(s)) return addDays(ctx.today, -1);
  if (["tomorrow", "tmr", "tmrw"].includes(s)) return addDays(ctx.today, 1);
  if (DATE_RE.test(s)) return isRealDate(s) ? s : null;

  const [ty, tm] = ctx.today.split("-").map(Number) as [number, number];
  const base = ctx.month && MONTH_RE.test(ctx.month) ? (ctx.month.split("-").map(Number) as [number, number]) : null;

  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;

  const parts = s.split(/[\s/.-]+/).filter(Boolean);
  if (parts.length > 3) return null;
  const words = parts.filter((p) => /[a-z]/.test(p));
  const nums = parts.filter((p) => /^\d+$/.test(p));
  if (words.length + nums.length !== parts.length || words.length > 1) return null;

  if (words.length === 1) {
    const mi = monthIndex(words[0]!);
    if (!mi || nums.length < 1 || nums.length > 2) return null;
    month = mi;
    day = Number(nums[0]);
    if (nums[1] !== undefined) year = Number(nums[1]);
  } else if (nums.length === 1) {
    day = Number(nums[0]);
  } else if (nums.length === 2 || nums.length === 3) {
    day = Number(nums[0]);
    month = Number(nums[1]);
    if (nums[2] !== undefined) year = Number(nums[2]);
  } else return null;

  if (year !== undefined && year < 100) year += 2000;
  if (month === undefined) {
    [year, month] = base ?? [ty, tm];
  } else if (year === undefined) {
    if (base) year = base[0];
    else {
      year = ty;
      // Without a year, take the most recent such date rather than one months ahead.
      const candidate = iso(year, month, day);
      if (isRealDate(candidate) && candidate > addDays(ctx.today, 31)) year -= 1;
    }
  }
  const out = iso(year!, month, day);
  return isRealDate(out) ? out : null;
}

/** "2026-10-21" → "21 Oct 2026", how the date box shows a date. */
export function formatDateInput(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return `${d} ${SHORT[m - 1]} ${y}`;
}

/** Last day of a "YYYY-MM" month, as "YYYY-MM-DD". */
export function lastDayOfMonth(ym: string): string {
  return addDays(`${shiftMonth(ym, 1)}-01`, -1);
}
