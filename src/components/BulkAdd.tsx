import { useEffect, useMemo, useRef, useState } from "react";
import type { SpaceDetail } from "../../shared/api";
import { dateLabel, isRealDate } from "../../shared/dates";
import { formatMoney, parseMoney } from "../../shared/money";
import { api, ApiError, errorMessage } from "../lib/api";
import { blankRow, clearDraft, loadDraft, rowHasContent, saveDraft, type Draft, type DraftRow } from "../lib/drafts";
import { noteMonth, useGroups, useSpaceMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";
import { DateField } from "./DateField";
import { Chip } from "./People";

const ROWS_TO_START = 3;

/**
 * Add several expenses that share a date (and usually a payer and the people splitting).
 * Rows are kept as a draft on this device while you type, and saved together in one request:
 * all of them or none.
 */
export function BulkAdd({ space, meId, defaultDate, month, onDone }: {
  space: SpaceDetail;
  meId: string;
  defaultDate: string;
  month: string | null;
  onDone(): void;
}) {
  const toast = useToast();
  const active = useMemo(() => space.members.filter((m) => m.active), [space.members]);
  const [draft, setDraft] = useState<Draft>(
    () =>
      loadDraft(meId, space.id) ?? {
        date: defaultDate,
        payerId: active.some((m) => m.id === meId) ? meId : (active[0]?.id ?? meId),
        people: active.map((m) => m.id),
        rows: Array.from({ length: ROWS_TO_START }, blankRow),
        savedAt: Date.now(),
      },
  );
  const [openPeople, setOpenPeople] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const focusKey = useRef<string | null>(null);

  // Keep the draft on this device as it changes.
  useEffect(() => saveDraft(meId, space.id, draft), [draft, meId, space.id]);
  useEffect(() => {
    if (!focusKey.current) return;
    document.getElementById(`bulk-desc-${focusKey.current}`)?.focus();
    focusKey.current = null;
  });

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch, savedAt: Date.now() }));
  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRowErrors((e) => ({ ...e, [key]: "" }));
    setDraft((d) => ({ ...d, savedAt: Date.now(), rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  };
  const addRow = () => {
    const row = blankRow();
    focusKey.current = row.key;
    setDraft((d) => ({ ...d, rows: [...d.rows, row] }));
  };
  const removeRow = (key: string) =>
    setDraft((d) => {
      const rows = d.rows.filter((r) => r.key !== key);
      return { ...d, rows: rows.length ? rows : [blankRow()] };
    });

  const nameOf = (id: string) => space.members.find((m) => m.id === id)?.name ?? "Former member";
  const peopleLabel = (ids: string[]) =>
    ids.length === active.length && active.every((m) => ids.includes(m.id)) ? `Everyone (${ids.length})` : ids.length === 1 ? nameOf(ids[0]!) : `${ids.length} people`;

  const groups = useGroups();
  const quickPicks = useMemo(() => {
    const here = new Set(active.map((m) => m.id));
    return (groups.data ?? []).map((g) => ({ id: g.id, name: g.name, ids: g.members.map((m) => m.id).filter((id) => here.has(id)) })).filter((g) => g.ids.length > 1);
  }, [groups.data, active]);

  const filled = draft.rows.filter(rowHasContent);
  const total = filled.reduce((a, r) => a + (parseMoney(r.amount) ?? 0), 0);

  const save = useSpaceMutation(
    space.id,
    (rows: DraftRow[]) =>
      api.bulkCreateExpenses(
        space.id,
        rows.map((r) => ({
          id: r.key,
          description: r.description.trim(),
          amountPaise: parseMoney(r.amount)!,
          payerId: r.payerId ?? draft.payerId,
          splitType: "equal",
          spentOn: draft.date,
          splits: (r.people ?? draft.people).map((userId) => ({ userId })),
        })),
      ),
    ["expenses", "balances", "months", "spaces"],
    () => noteMonth(space.id, draft.date.slice(0, 7)),
  );

  const submit = () => {
    if (save.isPending) return;
    if (!isRealDate(draft.date)) return setError("Choose the date for these expenses.");
    if (!filled.length) return setError("Fill in at least one row.");
    const errs: Record<string, string> = {};
    for (const r of filled) {
      if (!r.description.trim()) errs[r.key] = "Give it a name.";
      else if (!parseMoney(r.amount)) errs[r.key] = "Enter an amount above zero, like 250 or 250.50.";
      else if (!(r.people ?? draft.people).length) errs[r.key] = "Pick at least one person to split between.";
    }
    setRowErrors(errs);
    if (Object.keys(errs).length) return setError(`Fix ${Object.keys(errs).length === 1 ? "the marked row" : "the marked rows"} first.`);
    setError("");
    save.mutate(filled, {
      onSuccess: (res) => {
        clearDraft(meId, space.id);
        toast(`Saved ${res.expenses.length} ${res.expenses.length === 1 ? "expense" : "expenses"}`);
        onDone();
      },
      onError: (err) => {
        const index = err instanceof ApiError ? (err.details as { index?: number } | undefined)?.index : undefined;
        const row = index !== undefined ? filled[index] : undefined;
        if (row) setRowErrors({ [row.key]: errorMessage(err).replace(/^Row \d+: /, "") });
        setError(row ? "Nothing was saved. Fix the marked row and try again." : errorMessage(err));
      },
    });
  };

  const discard = () => {
    clearDraft(meId, space.id);
    toast("Draft discarded");
    onDone();
  };

  const togglePerson = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  return (
    <section className="card formcard bulk" aria-labelledby="bulk-title">
      <div className="sechead">
        <h2 id="bulk-title">Add several expenses</h2>
        <span className="draftnote">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
          Draft kept on this device
        </span>
      </div>

      <div className="bulkdefaults">
        <DateField label="Date for all" value={draft.date} onChange={(date) => update({ date })} month={month} />
        <div className="field">
          <label htmlFor="bulk-payer">Paid by (default)</label>
          <select id="bulk-payer" value={draft.payerId} onChange={(e) => update({ payerId: e.target.value })}>
            {active.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === meId ? " (you)" : ""}</option>)}
          </select>
        </div>
        <div className="field">
          <div className="legend">Split equally between (default)</div>
          {quickPicks.length > 0 && (
            <div className="groupbtns" style={{ marginBottom: 6 }}>
              <span className="lbl">Groups</span>
              {quickPicks.map((g) => (
                <button key={g.id} type="button" className="btn small" onClick={() => update({ people: g.ids })}>{g.name}</button>
              ))}
              <button type="button" className="btn small" onClick={() => update({ people: active.map((m) => m.id) })}>Everyone</button>
            </div>
          )}
          <div className="picks" role="group" aria-label="Default people to split between">
            {active.map((m) => (
              <label key={m.id} className="pick">
                <input type="checkbox" checked={draft.people.includes(m.id)} onChange={() => update({ people: togglePerson(draft.people, m.id) })} />
                <Chip id={m.id} small /><span>{m.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <ol className="bulkrows" aria-label="Expenses to add">
        <li className="bulkrow head" aria-hidden="true">
          <span>#</span><span>What</span><span>Amount</span><span>Paid by</span><span>Split</span><span></span>
        </li>
        {draft.rows.map((r, i) => {
          const people = r.people ?? draft.people;
          const err = rowErrors[r.key];
          return (
            <li key={r.key} className={`bulkrow${err ? " bad" : ""}`}>
              <span className="n">{i + 1}</span>
              <input
                id={`bulk-desc-${r.key}`}
                className="desc"
                type="text"
                aria-label={`Row ${i + 1}: what`}
                placeholder="Milk, cab, dinner…"
                maxLength={100}
                value={r.description}
                onChange={(e) => updateRow(r.key, { description: e.target.value })}
              />
              <div className="amtwrap amount">
                <span>₹</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Row ${i + 1}: amount`}
                  placeholder="0"
                  value={r.amount}
                  onChange={(e) => updateRow(r.key, { amount: e.target.value })}
                  onKeyDown={(e) => {
                    // Enter on the last row starts a new one.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (i === draft.rows.length - 1) addRow();
                      else document.getElementById(`bulk-desc-${draft.rows[i + 1]!.key}`)?.focus();
                    }
                  }}
                />
              </div>
              <select className="payer" aria-label={`Row ${i + 1}: paid by`} value={r.payerId ?? ""} onChange={(e) => updateRow(r.key, { payerId: e.target.value || null })}>
                <option value="">{nameOf(draft.payerId)}{draft.payerId === meId ? " (you)" : ""}</option>
                {active.filter((m) => m.id !== draft.payerId).map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === meId ? " (you)" : ""}</option>)}
              </select>
              <button
                type="button"
                className="btn small split"
                aria-expanded={openPeople === r.key}
                aria-label={`Row ${i + 1}: split between ${peopleLabel(people)}`}
                onClick={() => setOpenPeople(openPeople === r.key ? null : r.key)}
              >
                <span>{peopleLabel(people)}{r.people ? " *" : ""}</span><span aria-hidden="true">▾</span>
              </button>
              <button type="button" className="iconbtn" aria-label={`Remove row ${i + 1}`} onClick={() => removeRow(r.key)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
              {openPeople === r.key && (
                <div className="bulkpeople">
                  <div className="picks" role="group" aria-label={`Row ${i + 1}: people`}>
                    {active.map((m) => (
                      <label key={m.id} className="pick">
                        <input type="checkbox" checked={people.includes(m.id)} onChange={() => updateRow(r.key, { people: togglePerson(people, m.id) })} />
                        <Chip id={m.id} small /><span>{m.name}</span>
                      </label>
                    ))}
                  </div>
                  {r.people && <button type="button" className="linkbtn" style={{ marginTop: 6, fontSize: 13 }} onClick={() => updateRow(r.key, { people: null })}>Use the default people</button>}
                </div>
              )}
              {err && <span className="err rowerr" role="alert">{err}</span>}
            </li>
          );
        })}
      </ol>

      <div className="formfoot">
        <button type="button" className="btn" onClick={addRow}>+ Add row</button>
        <span className="grow">
          {filled.length
            ? `${filled.length} ${filled.length === 1 ? "expense" : "expenses"} · ${formatMoney(total)}${isRealDate(draft.date) ? ` · ${dateLabel(draft.date)}` : ""}`
            : "Press Enter in an amount to start the next row."}
          {draft.rows.some((r) => r.people) && " · * has its own split"}
        </span>
      </div>
      <div className="formfoot" style={{ marginTop: 10 }}>
        <button type="button" className="btn primary" disabled={save.isPending || !filled.length} onClick={submit}>
          {save.isPending ? "Saving…" : `Save all${filled.length ? ` (${filled.length})` : ""}`}
        </button>
        <button type="button" className="btn" onClick={onDone}>Close, keep draft</button>
        <ConfirmButton className="btn danger" confirmLabel="Confirm discard" onConfirm={discard} disabled={save.isPending}>Discard draft</ConfirmButton>
        <span className="err" role="alert">{error}</span>
      </div>
    </section>
  );
}
