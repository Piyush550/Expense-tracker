import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface SelectablePerson { id: string; name: string; registered?: boolean }

/** An inline searchable checklist: its bounded list never covers form fields or save actions. */
export function PeopleSelect({ people, ids, onIds, label, disabled = false }: {
  people: SelectablePerson[]; ids: string[]; onIds(ids: string[]): void; label: string; disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const selectedView = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const term = query.trim().toLocaleLowerCase();
  const selected = people.filter((p) => ids.includes(p.id));
  const filtered = useMemo(() => people.filter((p) => (!selectedOnly || ids.includes(p.id)) && p.name.toLocaleLowerCase().includes(term)), [people, ids, selectedOnly, term]);
  const highlighted = Math.min(active, Math.max(0, filtered.length - 1));
  const activePerson = filtered[highlighted];
  const hasUnselected = filtered.some((p) => !ids.includes(p.id));
  const changeView = (value: boolean) => {
    setSelectedOnly(value); setActive(0);
    if (results.current) results.current.scrollTop = 0;
  };
  const toggle = (personId: string) => {
    const removingFocusedRow = selectedOnly && ids.includes(personId) && document.activeElement?.id === `${id}-option-${personId}`;
    onIds(ids.includes(personId) ? ids.filter((value) => value !== personId) : [...ids, personId]);
    if (removingFocusedRow) requestAnimationFrame(() => selectedView.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    // An async directory can become ready after the dialog's initial focus pass.
    if (!disabled && input.current?.closest("dialog")?.querySelector(".modal-close") === document.activeElement) {
      input.current?.focus({ preventScroll: true });
    }
  }, [disabled]);

  useLayoutEffect(() => {
    if (!focused || !activePerson) return;
    const list = results.current;
    const option = document.getElementById(`${id}-option-${activePerson.id}`);
    if (!list || !option) return;
    const bounds = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    // Arrow navigation scrolls only the checklist, keeping the surrounding dialog stable.
    if (row.top < bounds.top + 4) list.scrollTop += row.top - bounds.top - 4;
    else if (row.bottom > bounds.bottom - 4) list.scrollTop += row.bottom - bounds.bottom + 4;
  }, [highlighted, activePerson, focused, id]);

  return <div className={`people-select${disabled ? " disabled" : ""}`}>
    <div className="people-label"><label htmlFor={id}>{label}</label><span aria-live="polite" aria-atomic="true">{selected.length} selected</span></div>
    <div className="people-selection-panel">
      <div className="people-search">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input ref={input} id={id} type="search" placeholder="Search people by name…" value={query} disabled={disabled} autoComplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-describedby={`${id}-help`}
          aria-activedescendant={focused && activePerson ? `${id}-option-${activePerson.id}` : undefined}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onChange={(event) => { setQuery(event.target.value); setActive(0); if (results.current) results.current.scrollTop = 0; }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive(Math.max(0, Math.min(filtered.length - 1, highlighted + (event.key === "ArrowDown" ? 1 : -1))));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (activePerson && !ids.includes(activePerson.id)) onIds([...ids, activePerson.id]);
              setQuery(""); setActive(0);
            } else if (event.key === "Escape" && query) {
              event.preventDefault(); event.stopPropagation(); setQuery(""); setActive(0);
            }
          }} />
        {!!query && <button type="button" className="people-search-clear" aria-label={`Clear search for ${label}`} disabled={disabled} onClick={() => { setQuery(""); setActive(0); input.current?.focus({ preventScroll: true }); }}>×</button>}
      </div>
      <div className="people-list-toolbar">
        <div className="people-view" role="group" aria-label={`${label}: view`}>
          <button type="button" aria-pressed={!selectedOnly} disabled={disabled} onClick={() => changeView(false)}>All <span>{people.length}</span></button>
          <button ref={selectedView} type="button" aria-pressed={selectedOnly} disabled={disabled} onClick={() => changeView(true)}>Selected <span>{selected.length}</span></button>
        </div>
        <div className="people-list-actions"><button type="button" className="linkbtn" disabled={disabled || !hasUnselected} onClick={() => onIds([...new Set([...ids, ...filtered.map((p) => p.id)])])}>{term ? "Select matches" : "Select all"}</button><button type="button" className="linkbtn" disabled={disabled || !ids.length} onClick={() => onIds([])}>Clear</button></div>
      </div>
      <div ref={results} className="people-results" id={`${id}-list`} role="listbox" aria-label={label} aria-multiselectable="true" aria-disabled={disabled}>
        {filtered.map((person, index) => {
          const checked = ids.includes(person.id);
          return <button key={person.id} id={`${id}-option-${person.id}`} type="button" role="option" tabIndex={-1} aria-selected={checked} disabled={disabled}
            className={`people-option${focused && highlighted === index ? " highlighted" : ""}`} onMouseDown={(event) => { if (document.activeElement === input.current) event.preventDefault(); }} onClick={() => toggle(person.id)} onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault(); setActive(Math.max(0, Math.min(filtered.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
                input.current?.focus({ preventScroll: true });
              }
            }}>
            <span className={`option-check${checked ? " checked" : ""}`} aria-hidden="true">{checked ? "✓" : ""}</span>
            <span className="person-initial" aria-hidden="true">{person.name.slice(0, 2)}</span><span className="person-option-name">{person.name}</span>
            {person.registered === false && <span className="person-status">Invited</span>}
          </button>;
        })}
        {!filtered.length && <div className="people-empty" role="status"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><strong>{term ? "No matching people" : selectedOnly ? "No people selected" : "No people available"}</strong><span>{term ? `Try another name${selectedOnly ? " or switch to All" : ""}.` : selectedOnly ? "Switch to All to choose people." : "Everyone available may already be in this space."}</span></div>}
      </div>
      <div className="people-help" id={`${id}-help`}><span>{term ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}` : "Choose as many people as you need"}</span><span className="people-keyboard-hint">↑ ↓ move · Enter adds</span></div>
    </div>
  </div>;
}
