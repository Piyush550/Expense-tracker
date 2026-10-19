import { currentMonth, monthLabel, shiftMonth } from "../../shared/dates";
import { useTheme, type ThemePref } from "../lib/theme";

export function Brand() {
  return (
    <div className="brand">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 14h3M8 17h6" />
      </svg>
      <span>Expense Tracker</span>
    </div>
  );
}

const THEMES: { id: ThemePref; label: string; icon: string }[] = [
  { id: "light", label: "Light", icon: "M12 3v1M12 20v1M4.2 4.2l.7.7M19.1 19.1l.7.7M3 12h1M20 12h1M4.2 19.8l.7-.7M19.1 4.9l.7-.7M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" },
  { id: "dark", label: "Dark", icon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" },
  { id: "system", label: "Auto", icon: "M3 5h18v11H3zM8 20h8M12 16v4" },
];

/** Light / Dark / Auto (follows the device). */
export function ThemeSwitch() {
  const [pref, setPref] = useTheme();
  return (
    <div className="themeswitch" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} type="button" aria-pressed={pref === t.id} onClick={() => setPref(t.id)} title={t.id === "system" ? "Follow this device's setting" : `${t.label} theme`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * ‹ Month › picker. The middle is a real dropdown of the months that have data (plus the one
 * shown), and, with `allowAll`, "All months" (value null). › stops at the later of this month
 * and the newest month with data, so it never walks into empty future months.
 */
export function MonthPicker({ month, months, onChange, allowAll }: {
  month: string | null;
  months: string[];
  onChange(month: string | null): void;
  allowAll?: boolean;
}) {
  const now = currentMonth();
  const options = [...new Set([now, ...(month ? [month] : []), ...months])].sort().reverse();
  const newest = options[0] ?? now;
  const oldest = options[options.length - 1] ?? now;
  return (
    <div className="monthnav">
      <button type="button" aria-label="Previous month" disabled={!month || month <= oldest} onClick={() => month && onChange(shiftMonth(month, -1))}>‹</button>
      <select aria-label="Month" value={month ?? "all"} onChange={(e) => onChange(e.target.value === "all" ? null : e.target.value)}>
        {allowAll && <option value="all">All months</option>}
        {options.map((m) => (
          <option key={m} value={m}>{monthLabel(m)}</option>
        ))}
      </select>
      <button type="button" aria-label="Next month" disabled={!month || month >= newest} onClick={() => month && onChange(shiftMonth(month, 1))}>›</button>
    </div>
  );
}
