import { useMemo, useState, type FormEvent } from "react";
import type { Expense, ExpenseInput, Member, SpaceDetail } from "../../shared/api";
import { isRealDate } from "../../shared/dates";
import { formatMoney, paiseToInput, parseMoney } from "../../shared/money";
import { computeShares, PERCENT_TOTAL, SplitError, type SplitInput, type SplitType } from "../../shared/split";
import { api, ApiError, errorMessage } from "../lib/api";
import { noteMonth, useGroups, useSpaceMutation } from "../lib/queries";
import { DateField } from "./DateField";
import { useToast } from "../lib/toast";
import { Chip } from "./People";

const TYPES: { type: SplitType; label: string }[] = [
  { type: "equal", label: "Equally" },
  { type: "exact", label: "Exact amounts" },
  { type: "percent", label: "Percent" },
  { type: "shares", label: "Shares" },
];

/** Text typed in a per-person box → the stored integer (paise, basis points or units). null = invalid. */
function parseValue(type: SplitType, text: string): number | null {
  const t = text.trim().replace(/[,\s₹%]/g, "");
  if (!t) return 0;
  if (type === "exact") return t === "0" ? 0 : parseMoney(t);
  if (type === "percent") {
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    const bp = Math.round(Number(t) * 100);
    return bp <= PERCENT_TOTAL ? bp : null;
  }
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

function valueToText(type: SplitType, v: number | null): string {
  if (v == null || v === 0) return "";
  if (type === "exact") return paiseToInput(v);
  if (type === "percent") return String(v / 100);
  return String(v);
}

export function ExpenseForm({ space, meId, expense, defaultDate, month, onDone }: {
  space: SpaceDetail;
  meId: string;
  expense: Expense | null;
  defaultDate: string;
  /** The month being viewed (recurring spaces): a typed bare day lands in it. */
  month: string | null;
  onDone(): void;
}) {
  const toast = useToast();
  const [id] = useState(() => expense?.id ?? crypto.randomUUID());

  // Active members, plus anyone already on this expense who has since left.
  const people = useMemo<Member[]>(() => {
    const onExpense = new Set(expense ? [expense.payerId, ...expense.shares.map((s) => s.userId)] : []);
    return space.members.filter((m) => m.active || onExpense.has(m.id));
  }, [space.members, expense]);
  const groups = useGroups();
  // Your groups that share at least two people with this space, as one-click picks.
  const quickPicks = useMemo(() => {
    const here = new Set(people.filter((p) => p.active).map((p) => p.id));
    return (groups.data ?? [])
      .map((g) => ({ id: g.id, name: g.name, ids: g.members.map((m) => m.id).filter((id) => here.has(id)), total: g.members.length }))
      .filter((g) => g.ids.length > 1);
  }, [groups.data, people]);

  const [description, setDescription] = useState(expense?.description ?? "");
  const [amountText, setAmountText] = useState(expense ? paiseToInput(expense.amountPaise) : "");
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? defaultDate);
  const [payerId, setPayerId] = useState(expense?.payerId ?? meId);
  const [remarks, setRemarks] = useState(expense?.remarks ?? "");
  const [splitType, setSplitType] = useState<SplitType>(expense?.splitType ?? "equal");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(expense ? expense.shares.map((s) => s.userId) : people.filter((p) => p.active).map((p) => p.id)),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((expense?.shares ?? []).map((s) => [s.userId, valueToText(expense!.splitType, s.splitValue)])),
  );
  const [error, setError] = useState("");

  const amount = parseMoney(amountText);

  // What gets sent, and the share preview computed exactly as the server will.
  const draft = useMemo(() => {
    let splits: SplitInput[];
    if (splitType === "equal") splits = people.filter((p) => selected.has(p.id)).map((p) => ({ userId: p.id }));
    else {
      splits = [];
      for (const p of people) {
        const v = parseValue(splitType, values[p.id] ?? "");
        if (v === null) return { splits: [], shares: null, problem: `Check the number for ${p.name}.`, assigned: 0 };
        if (v > 0) splits.push({ userId: p.id, value: v });
      }
    }
    const assigned = splits.reduce((a, s) => a + (s.value ?? 0), 0);
    if (!amount) return { splits, shares: null, problem: "", assigned };
    try {
      const shares = new Map(computeShares(amount, splitType, splits, id).map((s) => [s.userId, s.sharePaise]));
      return { splits, shares, problem: "", assigned };
    } catch (err) {
      return { splits, shares: null, problem: err instanceof SplitError ? err.message : "Check the split.", assigned };
    }
  }, [splitType, people, selected, values, amount, id]);

  /** Moves the form to `next` split mode, starting from `inSplit` (default: whoever is in the split now). */
  const switchType = (next: SplitType, inSplit = draft.shares ? [...draft.shares.keys()] : people.filter((p) => selected.has(p.id)).map((p) => p.id)) => {
    if (next === "equal") setSelected(new Set(inSplit));
    else if (next === "exact") {
      // Start from an equal split of the amount between these people (blank if no amount yet).
      const even = amount && inSplit.length ? computeShares(amount, "equal", inSplit.map((userId) => ({ userId })), id) : [];
      setValues(Object.fromEntries(even.map((s) => [s.userId, paiseToInput(s.sharePaise)])));
    }
    else if (next === "percent" && inSplit.length) {
      const each = Math.floor(PERCENT_TOTAL / inSplit.length);
      const extra = PERCENT_TOTAL - each * inSplit.length;
      setValues(Object.fromEntries(inSplit.map((u, i) => [u, String((each + (i < extra ? 1 : 0)) / 100)])));
    } else if (next === "shares") setValues(Object.fromEntries(inSplit.map((u) => [u, "1"])));
    else setValues({});
    setSplitType(next);
  };

  const save = useSpaceMutation(
    space.id,
    (input: ExpenseInput) => (expense ? api.updateExpense(expense.id, expense.version, input) : api.createExpense(space.id, id, input)),
    ["expenses", "balances", "months", "spaces"],
    (saved) => noteMonth(space.id, saved.spentOn.slice(0, 7)),
  );
  const pickGroup = (ids: string[]) => switchType(splitType, ids);
  const sameSet = (ids: string[]) => {
    const cur = draft.shares ? [...draft.shares.keys()] : splitType === "equal" ? [...selected] : [];
    return cur.length === ids.length && ids.every((i) => cur.includes(i));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    if (!isRealDate(spentOn)) return setError("Choose the date of the expense.");
    if (!description.trim()) return setError("Give the expense a name.");
    if (!amount) return setError("Enter an amount above zero, like 1250 or 1250.50.");
    if (draft.problem || !draft.shares) return setError(draft.problem || "Pick at least one person to split between.");
    setError("");
    save.mutate(
      { description: description.trim(), amountPaise: amount, payerId, splitType, spentOn, remarks: remarks.trim(), splits: draft.splits },
      {
        onSuccess: () => {
          toast(expense ? "Expense updated" : "Expense added");
          onDone();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "version_conflict") {
            setError("Someone else edited this expense just now. Close the form and open it again to see their changes.");
          } else setError(errorMessage(err));
        },
      },
    );
  };

  const toggle = (uid: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const sumNote = (() => {
    if (splitType === "exact" && amount) {
      const left = amount - draft.assigned;
      return left === 0 ? { ok: true, text: "Adds up to the total." } : { ok: false, text: left > 0 ? `${formatMoney(left)} left to assign.` : `${formatMoney(-left)} too much.` };
    }
    if (splitType === "percent") {
      const left = PERCENT_TOTAL - draft.assigned;
      return left === 0 ? { ok: true, text: "Adds up to 100%." } : { ok: false, text: left > 0 ? `${left / 100}% left to assign.` : `${-left / 100}% too much.` };
    }
    return null;
  })();

  return (
    <form className="card formcard" onSubmit={submit} noValidate>
      <div className="sechead"><h2>{expense ? "Edit expense" : "New expense"}</h2></div>
      <div className="formgrid">
        <DateField label="Date" value={spentOn} onChange={setSpentOn} month={month} />
        <div className="field name">
          <label htmlFor="f-name">Name of the expense</label>
          <input id="f-name" type="text" maxLength={100} placeholder="Dinner at Social, cab to airport…" value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="f-amt">Amount</label>
          <div className="amtwrap">
            <span>₹</span>
            <input id="f-amt" type="text" inputMode="decimal" placeholder="0" value={amountText} onChange={(e) => setAmountText(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="f-payer">Paid by</label>
          <select id="f-payer" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.id === meId ? " (you)" : ""}</option>
            ))}
          </select>
        </div>
        <div className="field full">
          <div className="legend">Split</div>
          <div className="seg" role="group" aria-label="How to split">
            {TYPES.map((t) => (
              <button key={t.type} type="button" aria-pressed={splitType === t.type} onClick={() => t.type !== splitType && switchType(t.type)}>{t.label}</button>
            ))}
          </div>
        </div>
        {quickPicks.length > 0 && (
          <div className="field full">
            <div className="groupbtns" role="group" aria-label="Pick a group">
              <span className="lbl">Groups</span>
              {quickPicks.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`btn small${sameSet(g.ids) ? " on" : ""}`}
                  aria-pressed={sameSet(g.ids)}
                  title={g.ids.length < g.total ? `${g.ids.length} of its ${g.total} people are in this space` : undefined}
                  onClick={() => pickGroup(g.ids)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field full">
          {splitType === "equal" ? (
            <>
              <div className="legend">
                People involved{" "}
                <span className="quick">
                  · <button type="button" className="linkbtn" onClick={() => setSelected(new Set(people.filter((p) => p.active).map((p) => p.id)))}>everyone</button>
                  {" · "}<button type="button" className="linkbtn" onClick={() => setSelected(new Set())}>clear</button>
                </span>
              </div>
              <div className="picks" role="group" aria-label="People involved">
                {people.map((p) => (
                  <label key={p.id} className="pick" title={p.email ?? undefined}>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    <Chip id={p.id} small />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <div className="splitlist">
              {people.map((p) => (
                <div key={p.id} className="splitrow">
                  <label htmlFor={`v-${p.id}`} className="who"><Chip id={p.id} small /><span>{p.name}</span></label>
                  <div className="inputwrap">
                    {splitType === "exact" && <span className="pre">₹</span>}
                    <input
                      id={`v-${p.id}`}
                      type="text"
                      inputMode={splitType === "shares" ? "numeric" : "decimal"}
                      className={splitType === "exact" ? "haspre" : splitType === "percent" ? "haspost" : ""}
                      placeholder="0"
                      value={values[p.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                    />
                    {splitType === "percent" && <span className="post">%</span>}
                  </div>
                  <span className="share amt">{draft.shares?.get(p.id) ? formatMoney(draft.shares.get(p.id)!) : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="field full">
          <label htmlFor="f-rem">Remarks</label>
          <textarea id="f-rem" rows={2} maxLength={500} placeholder="Optional. Who ordered extra, what the bill included…" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>
      <div className="formfoot">
        <button type="submit" className="btn primary" disabled={save.isPending}>{expense ? "Save changes" : "Add expense"}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <span className="grow">
          {sumNote ? (
            <span className={`splitsum ${sumNote.ok ? "ok" : "bad"}`}>{sumNote.text}</span>
          ) : splitType === "equal" && draft.shares ? (
            `Split equally: ${formatMoney(Math.min(...draft.shares.values()))}${new Set(draft.shares.values()).size > 1 ? "–" + formatMoney(Math.max(...draft.shares.values())) : ""} each between ${draft.shares.size} ${draft.shares.size === 1 ? "person" : "people"}.`
          ) : (
            draft.problem
          )}
        </span>
      </div>
      <div className="err" role="alert" style={{ marginTop: 8 }}>{error}</div>
    </form>
  );
}
