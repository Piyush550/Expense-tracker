import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Expense, Me, SpaceDetail } from "../../shared/api";
import { currentMonth, dateLabel, isRealDate, monthLabel, todayIso } from "../../shared/dates";
import { formatMoney } from "../../shared/money";
import { api, errorMessage } from "../lib/api";
import { downloadCsv } from "../lib/export";
import { keys, useExpenses, useSettlements } from "../lib/queries";
import { useToast } from "../lib/toast";
import { Modal } from "./Modal";
import { BulkAdd } from "./BulkAdd";
import { ExpenseForm } from "./ExpenseForm";
import { clearDraft, loadDraft, rowHasContent } from "../lib/drafts";
import { ExpenseList, PaymentList } from "./ExpenseList";
import { useName } from "./People";

export function ExpensesTab({ space, me, month }: { space: SpaceDetail; me: Me; month: string | null }) {
  const toast = useToast();
  const qc = useQueryClient();
  const name = useName();
  const period = month ?? undefined;
  const expenses = useExpenses(space.id, period);
  const payments = useSettlements(space.id, period);
  const [editing, setEditing] = useState<Expense | "new" | "bulk" | null>(null);
  const [, rerender] = useState(0);
  // A bulk-add draft left on this device for this space.
  const draft = editing === "bulk" ? null : loadDraft(me.id, space.id);
  const draftRows = draft?.rows.filter(rowHasContent).length ?? 0;
  const defaultDate = !month || month === currentMonth() ? todayIso() : `${month}-01`;
  const open = (next: Expense | "new" | "bulk") => {
    setEditing(next);
  };
  const [search, setSearch] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [involving, setInvolving] = useState("");

  const people = space.members;
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (expenses.data ?? []).filter(
      (e) =>
        (!term || e.description.toLowerCase().includes(term) || e.remarks.toLowerCase().includes(term)) &&
        (!paidBy || e.payerId === paidBy) &&
        (!involving || e.payerId === involving || e.shares.some((s) => s.userId === involving)),
    );
  }, [expenses.data, search, paidBy, involving]);
  const filtering = !!(search.trim() || paidBy || involving);
  const total = filtered.reduce((a, e) => a + e.amountPaise, 0);
  const myShare = filtered.reduce((a, e) => a + (e.shares.find((s) => s.userId === me.id)?.sharePaise ?? 0), 0);
  const periodName = month ? monthLabel(month) : "total";

  const exportCsv = async (all: boolean) => {
    try {
      const m = all ? undefined : period;
      const [ex, pay] = await Promise.all([
        qc.fetchQuery({ queryKey: keys.expenses(space.id, m), queryFn: () => api.expenses(space.id, m) }),
        qc.fetchQuery({ queryKey: keys.settlements(space.id, m), queryFn: () => api.settlements(space.id, m) }),
      ]);
      const slug = space.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "space";
      downloadCsv(`${slug}-${m ?? "all"}.csv`, ex, pay, name);
      toast("Download started");
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const exportFromMenu = (all: boolean, button: HTMLButtonElement) => {
    const menu = button.closest("details");
    if (menu) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
    void exportCsv(all);
  };

  return (
    <>
      <dl className="stats">
        <div><dt>{month ? `Spent in ${monthLabel(month)}` : "Spent in total"}</dt><dd>{formatMoney(total)}</dd></div>
        <div><dt>Expenses</dt><dd>{expenses.data ? filtered.length : "–"}</dd></div>
        <div><dt>Your share</dt><dd>{formatMoney(myShare)}</dd></div>
      </dl>

      {draftRows > 0 && !editing && (
        <div className="draftbanner">
          <span>
            <strong>Unsaved draft:</strong> {draftRows} {draftRows === 1 ? "expense" : "expenses"} for {draft && formatDraftDate(draft.date)}, kept on this device.
          </span>
          <span className="headbtns">
            <button type="button" className="btn primary small" onClick={() => open("bulk")}>Continue</button>
            <button type="button" className="btn small" onClick={() => { clearDraft(me.id, space.id); toast("Draft discarded"); rerender((n) => n + 1); }}>Discard</button>
          </span>
        </div>
      )}

      {editing && <Modal wide compact title={editing === "bulk" ? "Add several expenses" : editing === "new" ? "Add an expense" : "Edit expense"} description={space.name} onClose={() => setEditing(null)}>
        {editing === "bulk" ? <BulkAdd space={space} meId={me.id} defaultDate={defaultDate} month={month} onDone={() => setEditing(null)} /> : <ExpenseForm key={editing === "new" ? "new" : editing.id} space={space} meId={me.id} expense={editing === "new" ? null : editing} defaultDate={defaultDate} month={month} onDone={() => setEditing(null)} />}
      </Modal>}

      <section className="sec">
        <div className="sechead">
          <h2>Expenses{month ? ` in ${monthLabel(month)}` : ""}</h2>
          <div className="headbtns expenseactions">
            <button type="button" className="btn primary" onClick={() => open("new")}>+ Add expense</button>
            <button type="button" className="btn" onClick={() => open("bulk")}>Add several</button>
            <details className="exportmenu" onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.open = false;
                e.currentTarget.querySelector("summary")?.focus();
              }
            }}>
              <summary className="btn">Export <span aria-hidden="true">⌄</span></summary>
              <div className="exportoptions">
                <button type="button" className="btn small" onClick={(e) => exportFromMenu(false, e.currentTarget)}>Download {month ? "month" : "all"} (CSV)</button>
                {month && <button type="button" className="btn small" onClick={(e) => exportFromMenu(true, e.currentTarget)}>Download everything (CSV)</button>}
              </div>
            </details>
          </div>
        </div>
        <div className="filters" role="search">
          <input type="search" aria-label="Search expenses" placeholder="Search name or remarks" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Paid by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="">Paid by anyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>Paid by {p.name}{p.id === me.id ? " (you)" : ""}</option>)}
          </select>
          <select aria-label="Involving" value={involving} onChange={(e) => setInvolving(e.target.value)}>
            <option value="">Involving anyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>Involving {p.name}{p.id === me.id ? " (you)" : ""}</option>)}
          </select>
          {filtering && <button type="button" className="linkbtn" onClick={() => { setSearch(""); setPaidBy(""); setInvolving(""); }}>Clear filters</button>}
        </div>
        {expenses.error ? (
          <div className="banner warn">{errorMessage(expenses.error)}</div>
        ) : !expenses.data ? (
          <div className="card empty">Loading…</div>
        ) : !filtered.length ? (
          <div className="card empty">
            {filtering ? "No expenses match these filters." : `Nothing logged ${month ? `for ${monthLabel(month)}` : "yet"}. Whoever paid can add it with the button above.`}
          </div>
        ) : (
          <ExpenseList space={space} meId={me.id} expenses={filtered} onEdit={open} />
        )}
        {filtering && expenses.data && <p className="note">Showing {filtered.length} of {expenses.data.length} expenses ({periodName}).</p>}
      </section>

      <PaymentList space={space} meId={me.id} payments={payments.data} title={month ? `Payments for ${monthLabel(month)}` : "Payments"} />
    </>
  );
}

function formatDraftDate(iso: string): string {
  return isRealDate(iso) ? dateLabel(iso) : "no date yet";
}
