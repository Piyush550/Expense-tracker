// Balances, computed from the stored shares and payments. A recurring space is settled
// month by month, so balances can be limited to one month: that month's expenses plus the
// payments recorded against it (settlements.period).
import type { Balances, MemberBalance, MonthSummary } from "../shared/api";
import { monthRange } from "../shared/dates";
import { pairwiseDebts, simplifyDebts, type Debt } from "../shared/settlement";
import { num, type Queryable } from "./db";

export async function spaceBalances(q: Queryable, spaceId: string, simplify: boolean, month?: string): Promise<Balances> {
  const range = month ? monthRange(month) : null;
  const [members, shares, payments] = await Promise.all([
    q.query<{ user_id: string }>("SELECT user_id FROM space_members WHERE space_id = $1", [spaceId]),
    // Who owes whom per expense: each participant owes the payer their share.
    q.query<{ user_id: string; payer_id: string; total: unknown }>(
      `SELECT s.user_id, e.payer_id, SUM(s.share_paise) AS total
         FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
        WHERE e.space_id = $1 AND e.deleted_at IS NULL
          ${range ? "AND e.spent_on >= $2 AND e.spent_on < $3" : ""}
        GROUP BY s.user_id, e.payer_id`,
      range ? [spaceId, range.from, range.to] : [spaceId],
    ),
    q.query<{ from_user_id: string; to_user_id: string; total: unknown }>(
      `SELECT from_user_id, to_user_id, SUM(amount_paise) AS total
         FROM settlements WHERE space_id = $1 AND deleted_at IS NULL ${range ? "AND period = $2" : ""}
        GROUP BY from_user_id, to_user_id`,
      range ? [spaceId, range.from] : [spaceId],
    ),
  ]);

  const rows = new Map<string, MemberBalance>();
  const row = (userId: string) => {
    let r = rows.get(userId);
    if (!r) rows.set(userId, (r = { userId, paidPaise: 0, sharePaise: 0, settledPaise: 0, netPaise: 0 }));
    return r;
  };
  members.rows.forEach((m) => row(m.user_id));

  const debts: Debt[] = [];
  for (const s of shares.rows) {
    const amount = num(s.total);
    row(s.payer_id).paidPaise += amount;
    row(s.user_id).sharePaise += amount;
    debts.push({ from: s.user_id, to: s.payer_id, amountPaise: amount });
  }
  for (const p of payments.rows) {
    const amount = num(p.total);
    row(p.from_user_id).settledPaise += amount;
    row(p.to_user_id).settledPaise -= amount;
    // Paying someone cancels debt towards them, i.e. it is a debt in the other direction.
    debts.push({ from: p.to_user_id, to: p.from_user_id, amountPaise: amount });
  }

  const net: Record<string, number> = {};
  for (const r of rows.values()) {
    r.netPaise = r.paidPaise - r.sharePaise + r.settledPaise;
    net[r.userId] = r.netPaise;
  }
  return {
    month: month ?? null,
    simplified: simplify,
    members: [...rows.values()],
    transfers: simplify ? simplifyDebts(net) : pairwiseDebts(debts),
  };
}

/** The month-by-month sheet of a recurring space: spend and what is still unsettled. */
export async function monthlySummary(q: Queryable, spaceId: string): Promise<MonthSummary[]> {
  const [spent, shares, payments] = await Promise.all([
    q.query<{ m: string; total: unknown; n: unknown }>(
      `SELECT to_char(spent_on, 'YYYY-MM') AS m, SUM(amount_paise) AS total, COUNT(*) AS n
         FROM expenses WHERE space_id = $1 AND deleted_at IS NULL GROUP BY 1`,
      [spaceId],
    ),
    q.query<{ m: string; user_id: string; payer_id: string; total: unknown }>(
      `SELECT to_char(e.spent_on, 'YYYY-MM') AS m, s.user_id, e.payer_id, SUM(s.share_paise) AS total
         FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
        WHERE e.space_id = $1 AND e.deleted_at IS NULL GROUP BY 1, 2, 3`,
      [spaceId],
    ),
    q.query<{ m: string; from_user_id: string; to_user_id: string; total: unknown }>(
      `SELECT to_char(period, 'YYYY-MM') AS m, from_user_id, to_user_id, SUM(amount_paise) AS total
         FROM settlements WHERE space_id = $1 AND deleted_at IS NULL GROUP BY 1, 2, 3`,
      [spaceId],
    ),
  ]);

  const months = new Map<string, { summary: MonthSummary; net: Map<string, number> }>();
  const at = (m: string) => {
    let v = months.get(m);
    if (!v) months.set(m, (v = { summary: { month: m, spentPaise: 0, expenseCount: 0, outstandingPaise: 0 }, net: new Map() }));
    return v;
  };
  const add = (net: Map<string, number>, id: string, d: number) => net.set(id, (net.get(id) ?? 0) + d);

  for (const r of spent.rows) {
    const v = at(r.m).summary;
    v.spentPaise = num(r.total);
    v.expenseCount = num(r.n);
  }
  for (const r of shares.rows) {
    const { net } = at(r.m);
    add(net, r.payer_id, num(r.total));
    add(net, r.user_id, -num(r.total));
  }
  for (const r of payments.rows) {
    const { net } = at(r.m);
    add(net, r.from_user_id, num(r.total));
    add(net, r.to_user_id, -num(r.total));
  }
  for (const { summary, net } of months.values()) {
    // What creditors are still owed = what debtors still owe.
    summary.outstandingPaise = [...net.values()].reduce((a, v) => a + (v > 0 ? v : 0), 0);
  }
  return [...months.values()].map((v) => v.summary).sort((a, b) => b.month.localeCompare(a.month));
}

/** One person's net balance in one space, over all time. */
export async function memberNet(q: Queryable, spaceId: string, userId: string): Promise<number> {
  const { rows } = await q.query<{ net: unknown }>(
    `SELECT
       COALESCE((SELECT SUM(amount_paise) FROM expenses WHERE space_id = $1 AND payer_id = $2 AND deleted_at IS NULL), 0)
     - COALESCE((SELECT SUM(s.share_paise) FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
                  WHERE e.space_id = $1 AND s.user_id = $2 AND e.deleted_at IS NULL), 0)
     + COALESCE((SELECT SUM(amount_paise) FROM settlements WHERE space_id = $1 AND from_user_id = $2 AND deleted_at IS NULL), 0)
     - COALESCE((SELECT SUM(amount_paise) FROM settlements WHERE space_id = $1 AND to_user_id = $2 AND deleted_at IS NULL), 0)
       AS net`,
    [spaceId, userId],
  );
  return num(rows[0]?.net);
}
