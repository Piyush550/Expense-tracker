import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatMoney } from "../../shared/money";
import { initialSplitValues, parseSplitValue, previewSplit, splitFeedback, SPLIT_TYPES, toggleSplitGroup, type SplitGroup, type SplitSelection } from "../lib/split-draft";

import { QuickGroupOptions, type QuickConfigStatus } from "./QuickActions";

interface Person { id: string; name: string }
type PickerView = "individuals" | "groups";

/** Individuals and groups share one bounded picker; money is always split per person. */
export function SplitEditor({ people, selection, onChange, amount, seed, meId, groups = [], spaceId, canConfigure = false, onConfigStatus, title = "Split", disabled = false }: {
  people: Person[]; selection: SplitSelection; onChange(next: SplitSelection): void;
  amount: number | null; seed: string; meId: string; groups?: SplitGroup[];
  spaceId: string; canConfigure?: boolean; onConfigStatus?(status: QuickConfigStatus): void; title?: string; disabled?: boolean;
}) {
  const id = useId();
  const [view, setView] = useState<PickerView>(() => selection.selectedGroups?.length ? "groups" : "individuals");
  const [queries, setQueries] = useState({ individuals: "", groups: "" });
  const list = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { people: ids, splitType, values } = selection;
  const selectedGroups = selection.selectedGroups ?? [];
  const search = queries[view];
  const term = search.trim().toLocaleLowerCase();
  const filtered = useMemo(() => people.filter((person) => person.name.toLocaleLowerCase().includes(term)), [people, term]);
  const filteredGroups = useMemo(() => groups.filter((group) => group.name.toLocaleLowerCase().includes(term)), [groups, term]);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const preview = previewSplit(amount, splitType, ids, values, seed);
  const choose = (next: string[]) => onChange({ ...selection, people: next, selectedGroups: [],
    values: { ...values, ...Object.fromEntries(next.map((uid) => [uid, values[uid] ?? (splitType === "shares" ? "1" : "")])) } });
  const toggle = (uid: string) => choose(ids.includes(uid) ? ids.filter((selected) => selected !== uid) : [...ids, uid]);
  const changeView = (next: PickerView) => {
    setView(next);
    if (list.current) list.current.scrollTop = 0;
  };
  const focusOption = (index: number) => {
    const inputs = list.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)');
    const target = inputs?.[Math.max(0, Math.min((inputs?.length ?? 1) - 1, index))];
    target?.focus({ preventScroll: true });
    if (target && list.current) {
      const row = target.closest(".split-person, .split-group")!.getBoundingClientRect();
      const bounds = list.current.getBoundingClientRect();
      if (row.top < bounds.top) list.current.scrollTop += row.top - bounds.top;
      else if (row.bottom > bounds.bottom) list.current.scrollTop += row.bottom - bounds.bottom;
    }
  };
  const optionKey = (event: KeyboardEvent<HTMLInputElement>, toggleOption: () => void) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); toggleOption(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const options = Array.from(list.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)') ?? []);
      const index = options.indexOf(event.currentTarget);
      if (event.key === "ArrowUp" && index === 0) searchRef.current?.focus({ preventScroll: true });
      else focusOption(index + (event.key === "ArrowDown" ? 1 : -1));
    }
  };
  return <fieldset className="split-checklist" disabled={disabled}>
    <legend className="sr-only">{title}</legend>
    <div className="split-heading"><h3 title={title}>{title}</h3><div className="seg split-picker-view" role="group" aria-label="Choose participants by">
      <button type="button" aria-pressed={view === "individuals"} onClick={() => changeView("individuals")}>Individuals</button>
      <button type="button" aria-pressed={view === "groups"} onClick={() => changeView("groups")}>Groups</button>
    </div></div>
    <div className="seg split-modes" role="group" aria-label="How to split">{SPLIT_TYPES.map((item) => <button key={item.type} type="button" aria-pressed={item.type === splitType} onClick={() => item.type !== splitType && onChange({ ...selection, splitType: item.type, values: initialSplitValues(item.type, ids, amount, seed) })}>{item.label}</button>)}</div>
    <QuickGroupOptions spaceId={spaceId} groups={groups} selection={selection} onToggle={(group) => onChange(toggleSplitGroup(selection, group))} canConfigure={canConfigure} disabled={disabled} onStatus={onConfigStatus} />
    <input ref={searchRef} type="search" aria-label={view === "groups" ? "Search groups to split with" : "Search people to split with"} placeholder={view === "groups" ? "Search groups…" : "Search people…"} value={search} aria-controls={`${id}-options`} aria-describedby={`${id}-help`} onChange={(event) => setQueries((current) => ({ ...current, [view]: event.target.value }))} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); focusOption(event.key === "ArrowDown" ? 0 : Number.MAX_SAFE_INTEGER); }
      if (event.key === "Enter") {
        event.preventDefault();
        if (view === "individuals" && filtered[0]) toggle(filtered[0].id);
        if (view === "groups") { const group = filteredGroups.find((item) => item.ids.length > 0); if (group) onChange(toggleSplitGroup(selection, group)); }
      }
    }} />
    <div className="split-list-toolbar"><span>{view === "groups" && selectedGroups.length ? `${selectedGroups.length} ${selectedGroups.length === 1 ? "group" : "groups"} · ${ids.length} ${ids.length === 1 ? "person" : "people"}` : `${ids.length} selected`}</span><div>{view === "individuals" && <button type="button" className="linkbtn" onClick={() => choose(people.map((person) => person.id))}>Everyone</button>}<button type="button" className="linkbtn" onClick={() => choose([])}>Clear</button></div></div>
    <div ref={list} id={`${id}-options`} className={`split-people${view === "groups" ? " split-group-list" : ""}`} role="group" aria-label={view === "groups" ? "Groups sharing this expense" : "People sharing this expense"}>
      {view === "groups" ? <>
        {filteredGroups.map((group) => {
          const snapshot = selectedGroups.find((item) => item.id === group.id);
          const memberIds = snapshot?.people ?? group.ids;
          const memberNames = memberIds.map((uid) => names.get(uid) ?? "Former member").join(", ");
          const changed = snapshot && (snapshot.people.length !== group.ids.length || snapshot.people.some((uid) => !group.ids.includes(uid)));
          const count = group.ids.length === group.total ? `${group.total} ${group.total === 1 ? "person" : "people"}` : `${group.ids.length} of ${group.total} people in this space`;
          return <label key={group.id} className={`split-group${snapshot ? " selected" : ""}${!group.ids.length && !snapshot ? " unavailable" : ""}`}>
            <input type="checkbox" aria-label={`Select group ${group.name}`} aria-describedby={`${id}-${group.id}-count`} checked={!!snapshot} disabled={disabled || (!group.ids.length && !snapshot)} onChange={() => onChange(toggleSplitGroup(selection, group))} onKeyDown={(event) => optionKey(event, () => onChange(toggleSplitGroup(selection, group)))} />
            <span className="split-group-icon" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M20 20v-2a6 6 0 0 0-3-5" /></svg></span>
            <span className="split-group-text"><strong>{group.name}</strong><span id={`${id}-${group.id}-count`} title={memberNames}>{memberNames || "No members in this space"} · {changed ? "Saved selection; group has changed" : count}</span></span>
          </label>;
        })}
        {!filteredGroups.length && <p className="people-empty">{search ? "No matching groups." : "No saved groups yet. Create one in this space’s Groups tab to use it here."}</p>}
      </> : <>
        {filtered.map((person) => {
          const checked = ids.includes(person.id);
          const invalid = checked && splitType !== "equal" && parseSplitValue(splitType, values[person.id] ?? "") === null;
          return <div key={person.id} className={`split-person${checked ? " selected" : ""}`}>
            <label className="split-person-label"><input type="checkbox" checked={checked} onChange={() => toggle(person.id)} onKeyDown={(event) => optionKey(event, () => toggle(person.id))} /><span className="person-initial" aria-hidden="true">{person.name.slice(0, 2)}</span><span>{person.name}{person.id === meId ? " (you)" : ""}</span></label>
            {splitType === "equal" ? <span className="amt split-person-share">{checked && preview.shares ? formatMoney(preview.shares.get(person.id) ?? 0) : "—"}</span> : <div className={`split-value${splitType !== "exact" ? " with-preview" : ""}`}>
              <span aria-hidden="true">{splitType === "exact" ? "₹" : splitType === "percent" ? "%" : "×"}</span><input type="text" inputMode={splitType === "shares" ? "numeric" : "decimal"} aria-label={`${person.name}: ${splitType === "exact" ? "amount" : splitType === "percent" ? "percent" : "shares"}`} aria-invalid={invalid} disabled={!checked || disabled} placeholder="0" value={checked ? values[person.id] ?? "" : ""} onChange={(event) => onChange({ ...selection, values: { ...values, [person.id]: event.target.value } })} />
              {checked && preview.shares && splitType !== "exact" && <small>{formatMoney(preview.shares.get(person.id) ?? 0)}</small>}
            </div>}
          </div>;
        })}
        {!filtered.length && <p className="people-empty">{search ? "No matching people." : "No people available."}</p>}
      </>}
    </div>
    {view === "groups" ? <div id={`${id}-help`} className="split-group-review"><span>{selectedGroups.length ? "Overlapping members count once." : "Choose a group to replace the current people."}</span><button type="button" className="linkbtn" onClick={() => {
      setQueries((current) => ({ ...current, individuals: "" }));
      changeView("individuals");
      requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>('input[type="checkbox"]:checked, input[type="checkbox"]')?.focus({ preventScroll: true }));
    }}>Review individuals</button></div>
      : <div id={`${id}-help`} className="split-keyboard-hint">↑ ↓ to move · Enter to select · Space to toggle</div>}
    <p className={`split-status${preview.problem ? " bad" : preview.shares ? " ok" : ""}`} role="status">{splitFeedback(splitType, amount, preview)}</p>
  </fieldset>;
}
