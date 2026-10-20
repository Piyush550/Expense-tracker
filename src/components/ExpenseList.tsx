import type { Expense, Settlement, SpaceDetail } from "../../shared/api";
import { dateLabel, monthLabel } from "../../shared/dates";
import { formatMoney } from "../../shared/money";
import { api, errorMessage } from "../lib/api";
import { useSpaceMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";
import { Chip, useName, Who } from "./People";

const SPLIT_LABEL = { equal: "", exact: "exact amounts", percent: "by percent", shares: "by shares" } as const;

export function ExpenseList({ space, meId, expenses, onEdit }: {
  space: SpaceDetail;
  meId: string;
  expenses: Expense[];
  onEdit(e: Expense): void;
}) {
  const toast = useToast();
  const name = useName();
  const remove = useSpaceMutation(space.id, (id: string) => api.deleteExpense(id), ["expenses", "balances", "months", "spaces"]);
  const activeIds = space.members.filter((m) => m.active).map((m) => m.id);

  return (
    <div className="card logcard">
      <div className="loghead" aria-hidden="true">
        <span>Date</span><span>Expense</span><span>Paid by</span><span>Split</span><span className="r">Amount</span><span className="r">Actions</span>
      </div>
      <ul className="log">
        {expenses.map((e) => {
          const ids = e.shares.map((s) => s.userId);
          const everyone = e.splitType === "equal" && activeIds.length > 1 && activeIds.length === ids.length && activeIds.every((a) => ids.includes(a));
          const mine = e.shares.find((s) => s.userId === meId)?.sharePaise;
          return (
            <li key={e.id} className="x">
              <div className="x-date">{dateLabel(e.spentOn)}</div>
              <div className="x-main">
                <strong>{e.description}</strong>
                {e.remarks && <span className="rem">{e.remarks}</span>}
              </div>
              <div className="x-who"><span className="lbl">Paid by</span><Who id={e.payerId} you={meId} /></div>
              <div className="x-with">
                <span className="lbl">Split{SPLIT_LABEL[e.splitType] && ` ${SPLIT_LABEL[e.splitType]}`}</span>
                {everyone ? (
                  <span className="muted">Everyone ({ids.length})</span>
                ) : (
                  e.shares.map((s) => (
                    <span key={s.userId} title={`${name(s.userId)}: ${formatMoney(s.sharePaise)}`}><Chip id={s.userId} small /></span>
                  ))
                )}
              </div>
              <div className="x-amt amt">
                {formatMoney(e.amountPaise)}
                <small>{mine !== undefined ? `your share ${formatMoney(mine)}` : "you're not in this"}</small>
              </div>
              <div className="x-act">
                <button type="button" className="btn small" onClick={() => onEdit(e)}>Edit</button>
                <ConfirmButton
                  confirmLabel="Confirm delete"
                  disabled={remove.isPending}
                  onConfirm={() => remove.mutate(e.id, { onSuccess: () => toast("Expense deleted"), onError: (err) => toast(errorMessage(err)) })}
                >
                  Delete
                </ConfirmButton>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PaymentList({ space, meId, payments, title }: { space: SpaceDetail; meId: string; payments: Settlement[] | undefined; title: string }) {
  const toast = useToast();
  const name = useName();
  const remove = useSpaceMutation(space.id, (id: string) => api.deleteSettlement(id), ["settlements", "balances", "months", "spaces"]);
  if (!payments?.length) return null;
  return (
    <section className="sec">
      <div className="sechead"><h2>{title}</h2></div>
      <div className="card" style={{ padding: 0 }}>
        <ul className="paylist">
          {payments.map((p) => (
            <li key={p.id} className="payrow">
              <span className="x-date">{dateLabel(p.paidOn)}</span>
              <span className="grow">
                <span><Who id={p.fromUserId} you={meId} /> <span className="muted">paid</span> <strong>{name(p.toUserId)}{p.toUserId === meId ? " (you)" : ""}</strong></span>
                <span className="rem">
                  {space.kind === "recurring" && `For ${monthLabel(p.period)}`}
                  {space.kind === "recurring" && p.note && " · "}
                  {p.note}
                </span>
              </span>
              <span className="amt pos">{formatMoney(p.amountPaise)}</span>
              <ConfirmButton
                confirmLabel="Confirm delete"
                disabled={remove.isPending}
                onConfirm={() => remove.mutate(p.id, { onSuccess: () => toast("Payment deleted"), onError: (err) => toast(errorMessage(err)) })}
              >
                Delete
              </ConfirmButton>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
