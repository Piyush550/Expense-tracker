import { useId, useRef, useState } from "react";
import { dateLabel, formatDateInput, isRealDate, lastDayOfMonth, monthLabel, parseDateInput, todayIso } from "../../shared/dates";

/**
 * A date box you can type into ("21", "21 Oct", "21/10", "yesterday"), with a calendar button
 * for picking instead. A bare day lands in `month` (the month being viewed) when given.
 */
export function DateField({ label, value, onChange, month, compact = false }: {
  label: string;
  value: string;
  onChange(iso: string): void;
  month?: string | null;
  compact?: boolean;
}) {
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value ? formatDateInput(value) : "");
  const [shownFor, setShownFor] = useState(value);
  const today = todayIso();
  // Picked from the calendar or a chip: show it in the box.
  if (value !== shownFor) {
    setShownFor(value);
    setText(value ? formatDateInput(value) : "");
  }
  const parsed = parseDateInput(text, { today, month });

  const type = (next: string) => {
    setText(next);
    const iso = parseDateInput(next, { today, month });
    if (iso && iso !== value) {
      setShownFor(iso);
      onChange(iso);
    } else if (!iso && value) {
      // Do not silently submit the previous valid date after an invalid edit.
      setShownFor("");
      onChange("");
    }
  };
  const pick = (iso: string) => {
    if (isRealDate(iso)) onChange(iso);
  };

  // Quick picks: today and yesterday, or the start, middle and end of the viewed month.
  const chips: { iso: string; label: string }[] = [];
  if (!month || today.startsWith(month)) {
    chips.push({ iso: today, label: "Today" });
    const y = parseDateInput("yesterday", { today })!;
    if (!month || y.startsWith(month)) chips.push({ iso: y, label: "Yesterday" });
  } else {
    for (const iso of [`${month}-01`, `${month}-15`, lastDayOfMonth(month)]) chips.push({ iso, label: formatDateInput(iso).replace(/ \d{4}$/, "") });
  }

  return (
    <div className="field datefield">
      <label htmlFor={id}>{label}</label>
      <div className="dateinput">
        <input
          id={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder={month ? `e.g. 21 → 21 ${monthLabel(month).split(" ")[0]}` : "e.g. 21 Oct or yesterday"}
          value={text}
          aria-invalid={text.trim() !== "" && !parsed}
          aria-describedby={`${id}-hint`}
          onChange={(e) => type(e.target.value)}
          onBlur={() => parsed && setText(formatDateInput(parsed))}
        />
        <button
          type="button"
          className="calbtn"
          aria-label="Open calendar"
          title="Open calendar"
          onClick={() => {
            const el = picker.current;
            if (!el) return;
            try {
              el.showPicker();
            } catch {
              el.focus();
              el.click();
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
          </svg>
        </button>
        <input ref={picker} className="nativepicker" type="date" tabIndex={-1} aria-hidden="true" value={value} onChange={(e) => pick(e.target.value)} />
      </div>
      <div id={`${id}-hint`} className={`datehint${text.trim() && !parsed ? " bad" : compact && (!month || parsed?.startsWith(month)) ? " sr-only" : ""}`}>
        {text.trim() === ""
          ? "Type a date or pick one."
          : parsed
            ? dateLabel(parsed) +
              (parsed.slice(0, 4) !== today.slice(0, 4) ? ` ${parsed.slice(0, 4)}` : "") +
              (month && !parsed.startsWith(month) ? ` · goes under ${monthLabel(parsed.slice(0, 7))}` : "")
            : "Can't read that. Try 21, 21 Oct or 21/10."}
      </div>
      {!compact && <div className="datechips">
        {chips.map((c) => (
          <button key={c.iso} type="button" className={`btn small${c.iso === value ? " on" : ""}`} onClick={() => pick(c.iso)}>{c.label}</button>
        ))}
      </div>}
    </div>
  );
}
