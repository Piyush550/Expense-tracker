import { useEffect, useMemo, useRef, useState } from "react";
import type { SpaceDetail } from "../../shared/api";
import { isRealDate } from "../../shared/dates";
import { formatMoney, parseMoney } from "../../shared/money";
import { api, ApiError, errorMessage } from "../lib/api";
import { blankRow, clearDraft, loadDraft, rowHasContent, saveDraft, type Draft, type DraftRow } from "../lib/drafts";
import { noteMonth, useGroups, useSpaceMutation } from "../lib/queries";
import { copySelectedGroups, previewSplit, SPLIT_TYPES } from "../lib/split-draft";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";
import { DateField } from "./DateField";
import { SplitEditor } from "./SplitEditor";
import { useModalForm } from "./Modal";

export function BulkAdd({ space, meId, defaultDate, month, onDone }: {
  space: SpaceDetail; meId: string; defaultDate: string; month: string | null; onDone(): void;
}) {
  const toast = useToast();
  const active = useMemo(() => space.members.filter((member) => member.active), [space.members]);
  const activeIds = active.map((person) => person.id);
  const [draft, setDraft] = useState<Draft>(() => loadDraft(meId, space.id) ?? {
    version: 2, date: defaultDate, payerId: active.some((person) => person.id === meId) ? meId : active[0]?.id ?? meId,
    rows: Array.from({ length: 3 }, () => blankRow(active.some((person) => person.id === meId) ? meId : active[0]?.id ?? meId, activeIds)), savedAt: Date.now(),
  });
  const [selectedKey, setSelectedKey] = useState(draft.rows[0]?.key ?? "");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [quickStatus, setQuickStatus] = useState({ dirty: false, busy: false });
  const focusKey = useRef<string | null>(null);
  const selected = draft.rows.find((row) => row.key === selectedKey) ?? draft.rows[0];
  const editSplit = (key: string) => {
    setSelectedKey(key);
    // On stacked layouts, take the user to the editor they just requested.
    requestAnimationFrame(() => {
      const panel = document.getElementById("bulk-split-editor");
      const body = panel?.closest(".modal-body");
      if (panel && body && (panel.closest(".bulk-workspace")?.clientWidth ?? Infinity) <= 1000) {
        panel.focus({ preventScroll: true });
        body.scrollTop += panel.getBoundingClientRect().top - body.getBoundingClientRect().top;
      }
    });
  };
  useEffect(() => saveDraft(meId, space.id, draft), [draft, meId, space.id]);
  useEffect(() => {
    if (focusKey.current) { document.getElementById(`bulk-desc-${focusKey.current}`)?.focus(); focusKey.current = null; }
  });
  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRowErrors((current) => ({ ...current, [key]: "" })); setError("");
    setDraft((current) => ({ ...current, savedAt: Date.now(), rows: current.rows.map((row) => row.key === key ? { ...row, ...patch } : row) }));
  };
  const addRow = () => {
    if (draft.rows.length >= 50) return;
    const row = blankRow(draft.payerId, activeIds);
    focusKey.current = row.key; setSelectedKey(row.key);
    setDraft((current) => ({ ...current, savedAt: Date.now(), rows: [...current.rows, row] }));
  };
  const removeRow = (key: string) => {
    let rows = draft.rows.filter((row) => row.key !== key);
    if (!rows.length) rows = [blankRow(draft.payerId, activeIds)];
    if (selectedKey === key) setSelectedKey(rows[0]!.key);
    setDraft({ ...draft, rows, savedAt: Date.now() });
    setError("");
  };
  const copyToNext = () => {
    if (!selected) return;
    const index = draft.rows.findIndex((row) => row.key === selected.key);
    let next = draft.rows[index + 1];
    if (!next && draft.rows.length >= 50) return;
    const created = !next;
    next ??= blankRow(draft.payerId, activeIds);
    const copied = { ...next, people: [...selected.people], splitType: selected.splitType, values: { ...selected.values }, selectedGroups: copySelectedGroups(selected) };
    setDraft((current) => ({ ...current, savedAt: Date.now(), rows: created ? [...current.rows, copied] : current.rows.map((row) => row.key === copied.key ? copied : row) }));
    setRowErrors((current) => ({ ...current, [copied.key]: "" })); setError("");
    setSelectedKey(copied.key); toast("Split copied to the next expense");
  };
  const groups = useGroups(space.id);
  const quickPicks = useMemo(() => {
    const here = new Set(active.map((person) => person.id));
    return (groups.data ?? []).map((group) => ({ id: group.id, name: group.name, ids: group.members.map((person) => person.id).filter((uid) => here.has(uid)), total: group.members.length }));
  }, [groups.data, active]);
  const filled = draft.rows.filter(rowHasContent);
  const total = filled.reduce((sum, row) => sum + (parseMoney(row.amount) ?? 0), 0);
  const save = useSpaceMutation(space.id, (rows: DraftRow[]) => api.bulkCreateExpenses(space.id, rows.map((row) => ({
    id: row.key, description: row.description.trim(), amountPaise: parseMoney(row.amount)!, payerId: row.payerId,
    splitType: row.splitType, spentOn: draft.date, splits: previewSplit(parseMoney(row.amount), row.splitType, row.people, row.values, row.key).splits,
  }))), ["expenses", "balances", "months", "spaces"], () => noteMonth(space.id, draft.date.slice(0, 7)));
  const submit = () => {
    if (save.isPending || quickStatus.busy) return;
    if (!isRealDate(draft.date)) return setError("Choose the date for these expenses.");
    if (!filled.length) return setError("Fill in at least one row.");
    const errors: Record<string, string> = {};
    for (const row of filled) {
      const preview = previewSplit(parseMoney(row.amount), row.splitType, row.people, row.values, row.key);
      if (!row.description.trim()) errors[row.key] = "Give it a name.";
      else if (!parseMoney(row.amount)) errors[row.key] = "Enter an amount above zero.";
      else if (!activeIds.includes(row.payerId) || row.people.some((uid) => !activeIds.includes(uid))) errors[row.key] = "A person has left this space. Update the payer or people for this row.";
      else if (preview.problem || !preview.shares) errors[row.key] = preview.problem || "Check this split.";
    }
    setRowErrors(errors);
    const first = filled.find((row) => errors[row.key]);
    if (first) { editSplit(first.key); return setError("Nothing saved yet. Fix the marked rows first."); }
    setError("");
    save.mutate(filled, {
      onSuccess: (result) => { clearDraft(meId, space.id); toast(`Saved ${result.expenses.length} expenses`); onDone(); },
      onError: (err) => {
        const index = err instanceof ApiError ? (err.details as { index?: number } | undefined)?.index : undefined;
        const row = index !== undefined ? filled[index] : undefined;
        if (row) { setRowErrors({ [row.key]: errorMessage(err).replace(/^Row \d+: /, "") }); setSelectedKey(row.key); }
        setError(row ? "Nothing was saved. Fix the marked row and try again." : errorMessage(err));
      },
    });
  };
  const close = useModalForm(quickStatus.dirty, save.isPending || quickStatus.busy, onDone);
  const nameOf = (uid: string) => space.members.find((person) => person.id === uid)?.name ?? "Former member";
  const peopleLabel = (row: DraftRow) => row.selectedGroups?.length
    ? row.selectedGroups.map((group) => group.name).join(" + ")
    : row.people.length ? row.people.slice(0, 2).map(nameOf).join(", ") + (row.people.length > 2 ? ` +${row.people.length - 2}` : "") : "Choose people";
  return <section className="bulk-transaction-editor" aria-label="Add several expenses">
    <fieldset className="bulk-date-bar" disabled={save.isPending || quickStatus.busy}><DateField compact label="Date for these expenses" value={draft.date} onChange={(date) => { setDraft({ ...draft, date, savedAt: Date.now() }); setError(""); }} month={month} /><span className="draftnote">Draft saved on this device</span></fieldset>
    <div className="bulk-workspace">
      <div className="transaction-table-area">
        <fieldset className="transaction-table" disabled={save.isPending || quickStatus.busy}><legend className="sr-only">Expense rows</legend>
          <div className="transaction-head" aria-hidden="true"><span>#</span><span>Expense</span><span>Amount</span><span>Paid by</span><span>People / split</span><span /></div>
          <ol className="transaction-rows" aria-label="Expenses to add">{draft.rows.map((row, index) => <li key={row.key} className={`transaction-row${selected?.key === row.key ? " on" : ""}${rowErrors[row.key] ? " bad" : ""}`}>
            <span className="transaction-number">{index + 1}</span>
            <input type="text" id={`bulk-desc-${row.key}`} className="transaction-description" aria-label={`Row ${index + 1}: expense`} placeholder="Milk, cab, dinner…" maxLength={100} value={row.description} onFocus={() => setSelectedKey(row.key)} onChange={(event) => updateRow(row.key, { description: event.target.value })} />
            <div className="amtwrap transaction-amount"><span>₹</span><input type="text" inputMode="decimal" aria-label={`Row ${index + 1}: amount`} placeholder="0" value={row.amount} onFocus={() => setSelectedKey(row.key)} onChange={(event) => updateRow(row.key, { amount: event.target.value })} onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault(); if (index === draft.rows.length - 1) addRow(); else document.getElementById(`bulk-desc-${draft.rows[index + 1]!.key}`)?.focus();
            }} /></div>
            <select className="transaction-payer" aria-label={`Row ${index + 1}: paid by`} value={row.payerId} onFocus={() => setSelectedKey(row.key)} onChange={(event) => updateRow(row.key, { payerId: event.target.value })}>{!activeIds.includes(row.payerId) && <option value={row.payerId}>{nameOf(row.payerId)} (left)</option>}{active.map((person) => <option key={person.id} value={person.id}>{person.name}{person.id === meId ? " (you)" : ""}</option>)}</select>
            <button type="button" className="transaction-split" title={peopleLabel(row)} aria-label={`Row ${index + 1}: edit split`} aria-pressed={selected?.key === row.key} aria-controls="bulk-split-editor" onClick={() => editSplit(row.key)}><span>{peopleLabel(row)}</span><small>{SPLIT_TYPES.find((type) => type.type === row.splitType)?.label} · {row.people.length} {row.people.length === 1 ? "person" : "people"}</small></button>
            <button type="button" className="iconbtn transaction-remove" aria-label={`Remove row ${index + 1}`} onClick={() => removeRow(row.key)}>×</button>
            {rowErrors[row.key] && <p className="transaction-error err" role="alert">{rowErrors[row.key]}</p>}
          </li>)}</ol>
        </fieldset>
        <div className="transaction-add"><button type="button" className="btn" onClick={addRow} disabled={save.isPending || quickStatus.busy || draft.rows.length >= 50}>+ Add expense</button><span>Enter in an amount moves to the next row.</span></div>
      </div>
      <aside id="bulk-split-editor" tabIndex={-1} className="transaction-split-editor" aria-label="Selected transaction split">{selected && <>
        <SplitEditor key={selected.key} title={`Split · ${selected.description.trim() || `Row ${draft.rows.findIndex((row) => row.key === selected.key) + 1}`}`} people={active} selection={selected} onChange={(selection) => updateRow(selected.key, selection)} amount={parseMoney(selected.amount)} seed={selected.key} meId={meId} groups={quickPicks} spaceId={space.id} canConfigure={space.myRole === "owner"} onConfigStatus={setQuickStatus} disabled={save.isPending || quickStatus.busy} />
        <button type="button" className="btn copy-split" disabled={save.isPending || quickStatus.busy || (draft.rows.length >= 50 && selected.key === draft.rows.at(-1)?.key)} onClick={copyToNext}>Copy split to next expense</button>
      </>}</aside>
    </div>
    {error && <div className="editor-error err" role="alert">{error}</div>}
    <footer className="editor-footer"><div className="bulk-summary"><span><strong>{filled.length}</strong> expenses · <strong>{formatMoney(total)}</strong></span><ConfirmButton className="linkbtn" confirmLabel="Confirm discard" disabled={save.isPending || quickStatus.busy} onConfirm={() => { clearDraft(meId, space.id); toast("Draft discarded"); onDone(); }}>Discard draft</ConfirmButton></div><div className="editor-actions"><button type="button" className="btn" onClick={close} disabled={save.isPending || quickStatus.busy}>Close, keep draft</button><button type="button" className="btn primary" onClick={submit} disabled={save.isPending || quickStatus.busy || !filled.length}>{save.isPending ? "Saving…" : `Save all (${filled.length})`}</button></div></footer>
  </section>;
}
