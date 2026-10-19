import { useState, type FormEvent } from "react";
import type { SettlementInput, SpaceDetail } from "../../shared/api";
import { currentMonth, isRealDate, monthLabel, todayIso } from "../../shared/dates";
import { paiseToInput, parseMoney } from "../../shared/money";
import { api, errorMessage } from "../lib/api";
import { noteMonth, useSpaceMutation } from "../lib/queries";
import { DateField } from "./DateField";
import { useToast } from "../lib/toast";

export interface PaymentDraft {
  fromUserId: string;
  toUserId: string;
  amountPaise?: number;
  /** For recurring spaces: the month being settled. */
  period?: string;
}

export function PaymentForm({ space, meId, draft, onDone }: { space: SpaceDetail; meId: string; draft: PaymentDraft; onDone(): void }) {
  const toast = useToast();
  const [id] = useState(() => crypto.randomUUID());
  const active = space.members.filter((m) => m.active);
  const recurring = space.kind === "recurring";
  const [from, setFrom] = useState(draft.fromUserId);
  const [to, setTo] = useState(draft.toUserId);
  const [amountText, setAmountText] = useState(draft.amountPaise ? paiseToInput(draft.amountPaise) : "");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [period, setPeriod] = useState(draft.period ?? currentMonth());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const save = useSpaceMutation(
    space.id,
    (input: SettlementInput) => api.createSettlement(space.id, id, input),
    ["settlements", "balances", "months", "spaces"],
    (saved) => noteMonth(space.id, saved.period),
  );
  const periods = [...new Set([currentMonth(), period, ...space.months])].sort().reverse();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const amount = parseMoney(amountText);
    if (from === to) return setError("Pick two different people.");
    if (!amount) return setError("Enter the amount that was paid.");
    if (!isRealDate(paidOn)) return setError("Choose the date of the payment.");
    setError("");
    save.mutate(
      { fromUserId: from, toUserId: to, amountPaise: amount, paidOn, note: note.trim(), ...(recurring ? { period } : {}) },
      { onSuccess: () => { toast("Payment recorded"); onDone(); }, onError: (err) => setError(errorMessage(err)) },
    );
  };

  const select = (id: string, value: string, set: (v: string) => void) => (
    <select id={id} value={value} onChange={(e) => set(e.target.value)}>
      {active.map((m) => (
        <option key={m.id} value={m.id}>{m.name}{m.id === meId ? " (you)" : ""}</option>
      ))}
    </select>
  );

  return (
    <form className="card formcard" onSubmit={submit} noValidate>
      <div className="sechead"><h2>Record a payment</h2></div>
      <div className="formgrid">
        <div className="field"><label htmlFor="p-from">Who paid</label>{select("p-from", from, setFrom)}</div>
        <div className="field"><label htmlFor="p-to">Paid to</label>{select("p-to", to, setTo)}</div>
        <div className="field">
          <label htmlFor="p-amt">Amount</label>
          <div className="amtwrap"><span>₹</span><input id="p-amt" type="text" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} autoComplete="off" /></div>
        </div>
        <DateField label="Paid on" value={paidOn} onChange={setPaidOn} />
        {recurring && (
          <div className="field">
            <label htmlFor="p-period">Settles the month of</label>
            <select id="p-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {periods.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        )}
        <div className="field full"><label htmlFor="p-note">Note</label><input id="p-note" type="text" maxLength={200} placeholder="Optional. UPI, cash…" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="formfoot">
        <button type="submit" className="btn primary" disabled={save.isPending}>Record payment</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <span className="grow">Record it after the money has actually moved. A partial amount is fine.</span>
      </div>
      <div className="err" role="alert" style={{ marginTop: 8 }}>{error}</div>
    </form>
  );
}
