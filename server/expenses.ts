import type { Expense, Settlement } from "../shared/api";
import { monthRange } from "../shared/dates";
import { computeShares, SplitError, type Share, type SplitInput, type SplitType } from "../shared/split";
import { iso, num, type Queryable } from "./db";
import { HttpError } from "./errors";

const EXPENSE_COLUMNS = `e.id, e.space_id, e.description, e.amount_paise, e.payer_id, e.split_type,
  e.spent_on::text AS spent_on, e.remarks, e.version, e.created_by, e.created_at, e.updated_by, e.updated_at,
  COALESCE((SELECT json_agg(json_build_object('userId', s.user_id, 'sharePaise', s.share_paise, 'splitValue', s.split_value)
                            ORDER BY s.user_id)
              FROM expense_shares s WHERE s.expense_id = e.id), '[]'::json) AS shares`;

interface ExpenseRow {
  id: string;
  space_id: string;
  description: string;
  amount_paise: unknown;
  payer_id: string;
  split_type: SplitType;
  spent_on: string;
  remarks: string;
  version: number;
  created_by: string;
  created_at: unknown;
  updated_by: string;
  updated_at: unknown;
  shares: ShareRow[] | string;
}

interface ShareRow {
  userId: string;
  sharePaise: unknown;
  splitValue: unknown;
}

function toExpense(r: ExpenseRow): Expense {
  const shares: ShareRow[] = typeof r.shares === "string" ? JSON.parse(r.shares) : r.shares;
  return {
    id: r.id,
    spaceId: r.space_id,
    description: r.description,
    amountPaise: num(r.amount_paise),
    payerId: r.payer_id,
    splitType: r.split_type,
    spentOn: r.spent_on,
    remarks: r.remarks,
    version: num(r.version),
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedBy: r.updated_by,
    updatedAt: iso(r.updated_at),
    shares: shares.map((s) => ({
      userId: s.userId,
      sharePaise: num(s.sharePaise),
      splitValue: s.splitValue == null ? null : num(s.splitValue),
    })),
  };
}

export async function listExpenses(q: Queryable, spaceId: string, month?: string): Promise<Expense[]> {
  const params: unknown[] = [spaceId];
  let range = "";
  if (month) {
    const { from, to } = monthRange(month);
    params.push(from, to);
    range = "AND e.spent_on >= $2 AND e.spent_on < $3";
  }
  const { rows } = await q.query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses e
      WHERE e.space_id = $1 AND e.deleted_at IS NULL ${range}
      ORDER BY e.spent_on DESC, e.created_at DESC, e.id
      LIMIT 5000`,
    params,
  );
  return rows.map(toExpense);
}

/** The expense, if the caller is an active member of its space. */
export async function findExpense(q: Queryable, expenseId: string, userId: string, lock = false): Promise<Expense | null> {
  const { rows } = await q.query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses e
       JOIN space_members m ON m.space_id = e.space_id AND m.user_id = $2 AND m.left_at IS NULL
      WHERE e.id = $1 AND e.deleted_at IS NULL ${lock ? "FOR UPDATE OF e" : ""}`,
    [expenseId, userId],
  );
  return rows[0] ? toExpense(rows[0]) : null;
}

export function sharesFor(
  amountPaise: number,
  splitType: SplitType,
  splits: SplitInput[],
  seed: string,
  payerId: string,
  allowed: Set<string>,
): Share[] {
  const people = [payerId, ...splits.map((s) => s.userId)];
  if (people.some((p) => !allowed.has(p))) {
    throw new HttpError(422, "not_a_member", "Everyone on an expense must be a member of the space.");
  }
  try {
    return computeShares(amountPaise, splitType, splits, seed);
  } catch (err) {
    if (err instanceof SplitError) throw new HttpError(422, "invalid_split", err.message);
    throw err;
  }
}

export async function replaceShares(tx: Queryable, expenseId: string, shares: Share[]) {
  await tx.query("DELETE FROM expense_shares WHERE expense_id = $1", [expenseId]);
  const params: unknown[] = [expenseId];
  const values = shares.map((s) => {
    params.push(s.userId, s.sharePaise, s.splitValue);
    const n = params.length;
    return `($1, $${n - 2}, $${n - 1}, $${n})`;
  });
  await tx.query(`INSERT INTO expense_shares (expense_id, user_id, share_paise, split_value) VALUES ${values.join(", ")}`, params);
}

const SETTLEMENT_COLUMNS = `id, space_id, from_user_id, to_user_id, amount_paise, paid_on::text AS paid_on,
  to_char(period, 'YYYY-MM') AS period, note, created_by, created_at`;

interface SettlementRow {
  id: string;
  space_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_paise: unknown;
  paid_on: string;
  period: string;
  note: string;
  created_by: string;
  created_at: unknown;
}

const toSettlement = (r: SettlementRow): Settlement => ({
  id: r.id,
  spaceId: r.space_id,
  fromUserId: r.from_user_id,
  toUserId: r.to_user_id,
  amountPaise: num(r.amount_paise),
  paidOn: r.paid_on,
  period: r.period,
  note: r.note,
  createdBy: r.created_by,
  createdAt: iso(r.created_at),
});

/** Payments, optionally only those settling one month. */
export async function listSettlements(q: Queryable, spaceId: string, month?: string): Promise<Settlement[]> {
  const params: unknown[] = [spaceId];
  if (month) params.push(monthRange(month).from);
  const { rows } = await q.query<SettlementRow>(
    `SELECT ${SETTLEMENT_COLUMNS} FROM settlements
      WHERE space_id = $1 AND deleted_at IS NULL ${month ? "AND period = $2" : ""}
      ORDER BY paid_on DESC, created_at DESC, id LIMIT 5000`,
    params,
  );
  return rows.map(toSettlement);
}

export async function getSettlement(q: Queryable, id: string): Promise<Settlement | null> {
  const { rows } = await q.query<SettlementRow>(`SELECT ${SETTLEMENT_COLUMNS} FROM settlements WHERE id = $1`, [id]);
  return rows[0] ? toSettlement(rows[0]) : null;
}
