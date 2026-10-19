// Group balances, computed from the stored shares and payments.
import type { Balances, MemberBalance } from "../shared/api";
import { pairwiseDebts, simplifyDebts, type Debt } from "../shared/settlement";
import { num, type Queryable } from "./db";

export async function groupBalances(q: Queryable, groupId: string, simplify: boolean): Promise<Balances> {
  const [members, shares, payments] = await Promise.all([
    q.query<{ user_id: string }>("SELECT user_id FROM group_members WHERE group_id = $1", [groupId]),
    // Who owes whom per expense: each participant owes the payer their share.
    q.query<{ user_id: string; payer_id: string; total: unknown }>(
      `SELECT s.user_id, e.payer_id, SUM(s.share_paise) AS total
         FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
        WHERE e.group_id = $1 AND e.deleted_at IS NULL
        GROUP BY s.user_id, e.payer_id`,
      [groupId],
    ),
    q.query<{ from_user_id: string; to_user_id: string; total: unknown }>(
      `SELECT from_user_id, to_user_id, SUM(amount_paise) AS total
         FROM settlements WHERE group_id = $1 AND deleted_at IS NULL
        GROUP BY from_user_id, to_user_id`,
      [groupId],
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
    simplified: simplify,
    members: [...rows.values()],
    transfers: simplify ? simplifyDebts(net) : pairwiseDebts(debts),
  };
}

/** One person's net balance in one group. */
export async function memberNet(q: Queryable, groupId: string, userId: string): Promise<number> {
  const { rows } = await q.query<{ net: unknown }>(
    `SELECT
       COALESCE((SELECT SUM(amount_paise) FROM expenses WHERE group_id = $1 AND payer_id = $2 AND deleted_at IS NULL), 0)
     - COALESCE((SELECT SUM(s.share_paise) FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
                  WHERE e.group_id = $1 AND s.user_id = $2 AND e.deleted_at IS NULL), 0)
     + COALESCE((SELECT SUM(amount_paise) FROM settlements WHERE group_id = $1 AND from_user_id = $2 AND deleted_at IS NULL), 0)
     - COALESCE((SELECT SUM(amount_paise) FROM settlements WHERE group_id = $1 AND to_user_id = $2 AND deleted_at IS NULL), 0)
       AS net`,
    [groupId, userId],
  );
  return num(rows[0]?.net);
}
