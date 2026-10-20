import { useEffect, useId, useRef, useState } from "react";
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
        <button key={t.id} type="button" aria-label={t.label} aria-pressed={pref === t.id} onClick={() => setPref(t.id)} title={t.id === "system" ? "Follow this device's setting" : `${t.label} theme`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
          <span className="theme-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Calendar navigation is independent of recorded activity; empty months remain selectable. */
export function MonthPicker({ month, months, onChange, allowAll }: {
  month: string | null; months: string[]; onChange(month: string | null): void; allowAll?: boolean;
}) {
  const now = currentMonth();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [yearText, setYearText] = useState((month ?? now).slice(0, 4));
  const year = Number(yearText);
  const validYear = /^\d{4}$/.test(yearText) && year >= 100 && year <= 9998;
  const base = month ?? now;
  const choose = (next: string | null) => { onChange(next); setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    (menu.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? menu.current?.querySelector<HTMLInputElement>('input'))?.focus();
    const outside = (event: Event) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [open]);
  return <div ref={root} className="month-picker" onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <div className="monthnav">
      <button type="button" aria-label="Previous month" disabled={base <= "0100-01"} onClick={() => choose(shiftMonth(base, -1))}>‹</button>
      <button ref={trigger} type="button" className="month-trigger" aria-label="Choose month" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setYearText((month ?? now).slice(0, 4)); setOpen(!open); }}>{month ? monthLabel(month) : "All months"}<span aria-hidden="true">⌄</span></button>
      <button type="button" aria-label="Next month" disabled={base >= "9998-12"} onClick={() => choose(shiftMonth(base, 1))}>›</button>
    </div>
    {open && <div ref={menu} id={id} className="month-menu" role="group" aria-label="Choose month and year">
      <div className="month-year"><button type="button" className="iconbtn" aria-label="Previous year" disabled={validYear && year <= 100} onClick={() => setYearText(String((validYear ? year : Number(base.slice(0, 4))) - 1).padStart(4, "0"))}>‹</button><input type="text" inputMode="numeric" maxLength={4} aria-label="Year" aria-invalid={!validYear} value={yearText} onChange={(event) => setYearText(event.target.value.replace(/\D/g, ""))} /><button type="button" className="iconbtn" aria-label="Next year" disabled={validYear && year >= 9998} onClick={() => setYearText(String((validYear ? year : Number(base.slice(0, 4))) + 1))}>›</button></div>
      {!validYear && <p className="err">Enter a four-digit year from 0100 to 9998.</p>}
      <div className="month-grid">{Array.from({ length: 12 }, (_, index) => {
        const value = `${yearText}-${String(index + 1).padStart(2, "0")}`;
        return <button key={index} type="button" disabled={!validYear} aria-label={validYear ? monthLabel(value) : `Month ${index + 1}`} aria-pressed={month === value} className={months.includes(value) ? "has-activity" : ""} onClick={() => choose(value)} onKeyDown={(event) => {
          const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 3 : event.key === "ArrowUp" ? -3 : 0;
          if (offset) { event.preventDefault(); menu.current?.querySelectorAll<HTMLButtonElement>(".month-grid button")[Math.max(0, Math.min(11, index + offset))]?.focus(); }
        }}>{["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][index]}</button>;
      })}</div>
      <div className="month-shortcuts"><button type="button" className="linkbtn" onClick={() => choose(now)}>This month</button>{allowAll && <button type="button" className="linkbtn" onClick={() => choose(null)}>All months</button>}</div>
    </div>}
  </div>;
}
