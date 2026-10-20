import { useMemo, useRef, useState, type FormEvent } from "react";
import type { Expense, ExpenseInput, Member, SpaceDetail } from "../../shared/api";
import { isRealDate } from "../../shared/dates";
import { formatMoney, paiseToInput, parseMoney } from "../../shared/money";
import { api, ApiError, errorMessage } from "../lib/api";
import { noteMonth, useGroups, useSpaceMutation } from "../lib/queries";
import { previewSplit, splitValueText, type SplitSelection } from "../lib/split-draft";
import { DateField } from "./DateField";
import { useToast } from "../lib/toast";
import { SplitEditor } from "./SplitEditor";
import { useModalForm } from "./Modal";

export function ExpenseForm({ space, meId, expense, defaultDate, month, onDone }: {
  space: SpaceDetail; meId: string; expense: Expense | null; defaultDate: string;
  month: string | null; onDone(): void;
}) {
  const toast = useToast();
  const [id, setId] = useState(() => expense?.id ?? crypto.randomUUID());
  const nameInput = useRef<HTMLInputElement>(null);
  const people = useMemo<Member[]>(() => {
    const existing = new Set(expense ? [expense.payerId, ...expense.shares.map((share) => share.userId)] : []);
    return space.members.filter((person) => person.active || existing.has(person.id));
  }, [space.members, expense]);
  const groups = useGroups(space.id);
  const quickPicks = useMemo(() => {
    const active = new Set(people.filter((person) => person.active).map((person) => person.id));
    return (groups.data ?? []).map((group) => ({ id: group.id, name: group.name, ids: group.members.map((person) => person.id).filter((uid) => active.has(uid)), total: group.members.length }));
  }, [groups.data, people]);
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amountText, setAmountText] = useState(expense ? paiseToInput(expense.amountPaise) : "");
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? defaultDate);
  const [payerId, setPayerId] = useState(expense?.payerId ?? (people.some((person) => person.id === meId) ? meId : people[0]?.id ?? meId));
  const [remarks, setRemarks] = useState(expense?.remarks ?? "");
  const [selection, setSelection] = useState<SplitSelection>(() => ({
    splitType: expense?.splitType ?? "equal",
    people: expense ? expense.shares.map((share) => share.userId) : people.filter((person) => person.active).map((person) => person.id),
    values: Object.fromEntries((expense?.shares ?? []).map((share) => [share.userId, splitValueText(expense!.splitType, share.splitValue)])),
  }));
  const [error, setError] = useState("");
  const [quickStatus, setQuickStatus] = useState({ dirty: false, busy: false });
  const amount = parseMoney(amountText);
  const preview = previewSplit(amount, selection.splitType, selection.people, selection.values, id);
  const snapshot = JSON.stringify({ description, amountText, spentOn, payerId, remarks, selection });
  const [initial, setInitial] = useState(snapshot);
  const save = useSpaceMutation(space.id,
    (input: ExpenseInput) => expense ? api.updateExpense(expense.id, expense.version, input) : api.createExpense(space.id, id, input),
    ["expenses", "balances", "months", "spaces"], (saved) => noteMonth(space.id, saved.spentOn.slice(0, 7)));
  const cancel = useModalForm(snapshot !== initial || quickStatus.dirty, save.isPending || quickStatus.busy, onDone);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (save.isPending || quickStatus.busy) return;
    if (!isRealDate(spentOn)) return setError("Choose the date of the expense.");
    if (!description.trim()) return setError("Give the expense a name.");
    if (!amount) return setError("Enter an amount above zero, like 1250 or 1250.50.");
    if (preview.problem || !preview.shares) return setError(preview.problem || "Pick at least one person to split between.");
    const another = (event.nativeEvent as SubmitEvent).submitter instanceof HTMLButtonElement && ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value === "another";
    setError("");
    save.mutate({ description: description.trim(), amountPaise: amount, payerId, splitType: selection.splitType, spentOn, remarks: remarks.trim(), splits: preview.splits }, {
      onSuccess: () => {
        toast(expense ? "Expense updated" : "Expense added");
        if (!another || expense) return onDone();
        // A fresh ID prevents Save & add another from replaying the previous expense.
        const next = { ...selection, values: selection.splitType === "exact" ? {} : { ...selection.values } };
        setId(crypto.randomUUID()); setDescription(""); setAmountText(""); setRemarks(""); setSelection(next);
        setInitial(JSON.stringify({ description: "", amountText: "", spentOn, payerId, remarks: "", selection: next }));
        nameInput.current?.focus();
      },
      onError: (err) => setError(err instanceof ApiError && err.code === "version_conflict"
        ? "Someone else edited this expense just now. Close the form and open it again to see their changes." : errorMessage(err)),
    });
  };
  return <form className="expense-editor compact-expense" onSubmit={submit} noValidate>
    <fieldset className="expense-layout" disabled={save.isPending || quickStatus.busy}>
      <div className="expense-details">
        <h3>Expense details</h3>
        <div className="field"><label htmlFor="f-name">Expense</label><input ref={nameInput} id="f-name" type="text" maxLength={100} placeholder="Dinner, groceries, a cab…" value={description} onChange={(event) => setDescription(event.target.value)} autoComplete="off" autoFocus /></div>
        <div className="expense-amount-date">
          <div className="field"><label htmlFor="f-amt">Amount</label><div className="amtwrap"><span>₹</span><input id="f-amt" type="text" inputMode="decimal" placeholder="0.00" value={amountText} onChange={(event) => setAmountText(event.target.value)} autoComplete="off" /></div></div>
          <DateField compact label="Date" value={spentOn} onChange={setSpentOn} month={month} />
        </div>
        <div className="field"><label htmlFor="f-payer">Paid by</label><select id="f-payer" value={payerId} onChange={(event) => setPayerId(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.id === meId ? " (you)" : ""}</option>)}</select></div>
        <div className="field"><label htmlFor="f-rem">Remarks <span className="muted">· optional</span></label><input id="f-rem" type="text" maxLength={500} placeholder="Add a note…" value={remarks} onChange={(event) => setRemarks(event.target.value)} /></div>
      </div>
      <div className="split-panel"><SplitEditor people={people} selection={selection} onChange={setSelection} amount={amount} seed={id} meId={meId} groups={quickPicks} spaceId={space.id} canConfigure={space.myRole === "owner"} onConfigStatus={setQuickStatus} disabled={save.isPending || quickStatus.busy} /></div>
    </fieldset>
    {error && <div className="editor-error err" role="alert">{error}</div>}
    <footer className="editor-footer"><div className="expense-totals"><span>Total<strong>{amount ? formatMoney(amount) : "—"}</strong></span><span>Your share<strong>{preview.shares ? formatMoney(preview.shares.get(meId) ?? 0) : "—"}</strong></span></div><div className="editor-actions"><button type="button" className="btn" disabled={save.isPending || quickStatus.busy} onClick={cancel}>Cancel</button><button type="submit" className="btn primary" disabled={save.isPending || quickStatus.busy}>{save.isPending ? "Saving…" : expense ? "Save changes" : "Add expense"}</button>{!expense && <button type="submit" value="another" className="btn save-another" disabled={save.isPending || quickStatus.busy}>Save & add another</button>}</div></footer>
  </form>;
}
