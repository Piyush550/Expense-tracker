import { monthLabel, shiftMonth } from "../../shared/dates";
import { useTheme } from "../lib/theme";

export interface MonthNav {
  month: string;
  months: string[];
  onChange(month: string): void;
}

function ThemeButton() {
  const [theme, toggle] = useTheme();
  const dark = theme === "dark";
  const label = `Switch to ${dark ? "light" : "dark"} theme`;
  return (
    <button type="button" className="themebtn" onClick={toggle} aria-label={label} title={label}>
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
      <span>{dark ? "Light" : "Dark"}</span>
    </button>
  );
}

export function Header({ subtitle, nav }: { subtitle: string; nav?: MonthNav }) {
  const options = nav ? [...new Set([nav.month, ...nav.months])].sort().reverse() : [];
  return (
    <header className="titlebar">
      <div>
        <h1>Expense Tracker</h1>
        <p className="sub">{subtitle}</p>
      </div>
      <div className="tools">
        <ThemeButton />
        {nav && (
          <div className="monthnav">
            <button type="button" aria-label="Previous month" onClick={() => nav.onChange(shiftMonth(nav.month, -1))}>‹</button>
            <select aria-label="Month" value={nav.month} onChange={(e) => nav.onChange(e.target.value)}>
              {options.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
            <button type="button" aria-label="Next month" onClick={() => nav.onChange(shiftMonth(nav.month, 1))}>›</button>
          </div>
        )}
      </div>
    </header>
  );
}
