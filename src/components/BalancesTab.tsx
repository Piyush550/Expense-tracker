import { useState } from "react";
import type { Me, SpaceDetail } from "../../shared/api";
import { monthLabel } from "../../shared/dates";
import { formatMoney } from "../../shared/money";
import { errorMessage } from "../lib/api";
import { copyText, summaryText } from "../lib/export";
import { useBalances, useMonths } from "../lib/queries";
import { useToast } from "../lib/toast";
import { BalancesTable } from "./BalancesTable";
import { PaymentForm, type PaymentDraft } from "./PaymentForm";
import { useName } from "./People";
import { SettleUp } from "./SettleUp";

/** Month-by-month sheet of a recurring space. Clicking a row opens that month. */
function MonthSheet({ spaceId, month, onPick }: { spaceId: string; month: string | null; onPick(m: string): void }) {
  const months = useMonths(spaceId, true);
  if (!months.data?.length) return null;
  return (
    <section className="sec">
      <div className="sechead"><h2>Month by month</h2></div>
      <div className="card">
        <div className="tablewrap">
          <table className="sheet">
            <thead><tr><th>Month</th><th className="r">Spent</th><th className="r">Expenses</th><th className="r">Still to settle</th></tr></thead>
            <tbody>
              {months.data.map((m) => (
                <tr key={m.month} className={m.month === month ? "on" : ""} onClick={() => onPick(m.month)}>
                  <td><button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); onPick(m.month); }}>{monthLabel(m.month)}</button></td>
                  <td className="r amt">{formatMoney(m.spentPaise)}</td>
                  <td className="r">{m.expenseCount}</td>
                  <td className="r">
                    {m.outstandingPaise ? <span className="badge neg">{formatMoney(m.outstandingPaise)}</span> : <span className="badge pos">settled</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function BalancesTab({ space, me, month, onMonth }: { space: SpaceDetail; me: Me; month: string | null; onMonth(m: string | null): void }) {
  const toast = useToast();
  const name = useName();
  const balances = useBalances(space.id, month ?? undefined);
  const [paying, setPaying] = useState<PaymentDraft | null>(null);
  const recurring = space.kind === "recurring";
  const scope = month ? monthLabel(month) : recurring ? "all months together" : "the whole space";

  return (
    <>
      {recurring && <MonthSheet spaceId={space.id} month={month} onPick={onMonth} />}
      {paying && (
        <PaymentForm key={`${paying.fromUserId}-${paying.toUserId}-${paying.period}`} space={space} meId={me.id} draft={paying} onDone={() => setPaying(null)} />
      )}
      {balances.error && <div className="banner warn">{errorMessage(balances.error)}</div>}
      <div className="cols">
        <SettleUp
          balances={balances.data}
          meId={me.id}
          scope={scope}
          onRecord={(t) => {
            setPaying({ fromUserId: t.from, toUserId: t.to, amountPaise: t.amountPaise, period: month ?? undefined });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onCopy={async () => {
            const ok = await copyText(summaryText(space.name, month ? monthLabel(month) : "All time", balances.data?.transfers ?? [], name));
            toast(ok ? "Summary copied" : "Could not copy. Select the payments and copy them by hand.");
          }}
        />
        <BalancesTable balances={balances.data} meId={me.id} />
      </div>
      <div className="sec">
        <button type="button" className="btn small" onClick={() => {
          const other = space.members.find((m) => m.active && m.id !== me.id);
          setPaying({ fromUserId: me.id, toUserId: other?.id ?? me.id, period: month ?? undefined });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}>
          + Record a payment
        </button>
      </div>
    </>
  );
}
