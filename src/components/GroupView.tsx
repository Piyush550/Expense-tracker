import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Expense, GroupDetail, Me } from "../../shared/api";
import { currentMonth, monthLabel, todayIso } from "../../shared/dates";
import { formatMoney } from "../../shared/money";
import { api, errorMessage } from "../lib/api";
import { copyText, downloadCsv, summaryText } from "../lib/export";
import { keys, useBalances, useExpenses, useSettlements } from "../lib/queries";
import { useToast } from "../lib/toast";
import { BalancesTable } from "./BalancesTable";
import { ExpenseForm } from "./ExpenseForm";
import { ExpenseList, PaymentList } from "./ExpenseList";
import { GroupSettings } from "./GroupSettings";
import { Members } from "./Members";
import { PaymentForm, type PaymentDraft } from "./PaymentForm";
import { PeopleContext } from "./People";
import { SettleUp } from "./SettleUp";

export function GroupView({ group, me, month, onLeave }: { group: GroupDetail; me: Me; month: string; onLeave(): void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const balances = useBalances(group.id);
  const expenses = useExpenses(group.id, month);
  const payments = useSettlements(group.id, month);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [paying, setPaying] = useState<PaymentDraft | null>(null);

  const people = useMemo(() => new Map(group.members.map((m) => [m.id, m])), [group.members]);
  const name = (id: string) => people.get(id)?.name ?? "Former member";
  const monthTotal = (expenses.data ?? []).reduce((a, e) => a + e.amountPaise, 0);
  const myNet = balances.data?.members.find((m) => m.userId === me.id)?.netPaise ?? 0;
  const loadError = balances.error ?? expenses.error ?? payments.error;

  const exportCsv = async (all: boolean) => {
    try {
      const m = all ? undefined : month;
      const [ex, pay] = await Promise.all([
        qc.fetchQuery({ queryKey: keys.expenses(group.id, m), queryFn: () => api.expenses(group.id, m) }),
        qc.fetchQuery({ queryKey: keys.settlements(group.id, m), queryFn: () => api.settlements(group.id, m) }),
      ]);
      const slug = group.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
      downloadCsv(`${slug}-${all ? "all" : month}.csv`, ex, pay, name);
      toast("Download started");
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <PeopleContext.Provider value={people}>
      <dl className="stats">
        <div><dt>Spent in {monthLabel(month)}</dt><dd>{formatMoney(monthTotal)}</dd></div>
        <div><dt>Expenses</dt><dd>{expenses.data?.length ?? "–"}</dd></div>
        <div>
          <dt>Your balance</dt>
          <dd className={myNet > 0 ? "amt pos" : myNet < 0 ? "amt neg" : ""}>{myNet > 0 ? "+" : ""}{formatMoney(myNet)}</dd>
        </div>
        <div><dt>Payments to settle</dt><dd>{balances.data?.transfers.length ?? "–"}</dd></div>
      </dl>

      {loadError && <div className="banner warn">{errorMessage(loadError)}</div>}

      {editing && (
        <ExpenseForm
          key={editing === "new" ? "new" : editing.id}
          group={group}
          meId={me.id}
          expense={editing === "new" ? null : editing}
          defaultDate={month === currentMonth() ? todayIso() : `${month}-01`}
          onDone={() => setEditing(null)}
        />
      )}
      {paying && <PaymentForm key={`${paying.fromUserId}-${paying.toUserId}`} group={group} meId={me.id} draft={paying} onDone={() => setPaying(null)} />}

      <div className="cols">
        <SettleUp
          balances={balances.data}
          meId={me.id}
          onRecord={(t) => { setEditing(null); setPaying({ fromUserId: t.from, toUserId: t.to, amountPaise: t.amountPaise }); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onCopy={async () => {
            const ok = await copyText(summaryText(group.name, monthLabel(month), monthTotal, balances.data?.transfers ?? [], name));
            toast(ok ? "Summary copied" : "Could not copy. Select the payments and copy them by hand.");
          }}
        />
        <BalancesTable balances={balances.data} meId={me.id} />
      </div>

      <ExpenseList
        group={group}
        meId={me.id}
        month={month}
        expenses={expenses.data}
        onAdd={() => { setPaying(null); setEditing("new"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        onEdit={(e) => { setPaying(null); setEditing(e); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        onCsvMonth={() => exportCsv(false)}
        onCsvAll={() => exportCsv(true)}
      />
      <PaymentList group={group} meId={me.id} month={month} payments={payments.data} />
      <div className="sec">
        <button type="button" className="btn small" onClick={() => {
          const other = group.members.find((m) => m.active && m.id !== me.id);
          setEditing(null);
          setPaying({ fromUserId: me.id, toUserId: other?.id ?? me.id });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}>
          + Record a payment
        </button>
      </div>
      <Members group={group} meId={me.id} onLeft={onLeave} />
      <GroupSettings key={group.id} group={group} onDeleted={onLeave} />
    </PeopleContext.Provider>
  );
}
