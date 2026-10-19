// Request and response shapes shared by the API (server/) and the app (src/).
import type { SplitType } from "./split";
import type { Transfer } from "./settlement";

export type Role = "owner" | "member";
/** Recurring spaces are settled month by month; one-time spaces once, over everything. */
export type SpaceKind = "recurring" | "one_time";

export interface Me {
  id: string;
  name: string;
  email: string;
}

export interface SpaceSummary {
  id: string;
  name: string;
  kind: SpaceKind;
  myRole: Role;
  memberCount: number;
  /** The signed-in user's net balance in this space over all time (positive = is owed). */
  myBalancePaise: number;
}

export interface Member {
  id: string;
  name: string;
  email: string | null;
  /** False until the person signs in for the first time. */
  registered: boolean;
  role: Role;
  /** False once they have left or been removed. Kept because past expenses name them. */
  active: boolean;
}

export interface SpaceDetail {
  id: string;
  name: string;
  kind: SpaceKind;
  simplifyDebts: boolean;
  myRole: Role;
  members: Member[];
  /** Months ("YYYY-MM") that have expenses or payments, newest first. */
  months: string[];
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
  registered: boolean;
}

/** A reusable list of people, usable in every space. */
export interface Group {
  id: string;
  name: string;
  createdBy: string;
  /** Only the person who made a group can change or delete it. */
  canEdit: boolean;
  members: Person[];
}

export interface ExpenseShare {
  userId: string;
  sharePaise: number;
  splitValue: number | null;
}

export interface Expense {
  id: string;
  spaceId: string;
  description: string;
  amountPaise: number;
  payerId: string;
  splitType: SplitType;
  spentOn: string;
  remarks: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  shares: ExpenseShare[];
}

export interface ExpenseInput {
  description: string;
  amountPaise: number;
  payerId: string;
  splitType: SplitType;
  spentOn: string;
  remarks?: string;
  splits: { userId: string; value?: number | null }[];
}

export interface Settlement {
  id: string;
  spaceId: string;
  fromUserId: string;
  toUserId: string;
  amountPaise: number;
  paidOn: string;
  /** The month ("YYYY-MM") this payment settles. */
  period: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface SettlementInput {
  fromUserId: string;
  toUserId: string;
  amountPaise: number;
  paidOn: string;
  /** Defaults to the month of paidOn. */
  period?: string;
  note?: string;
}

export interface MemberBalance {
  userId: string;
  /** Total the person paid for expenses. */
  paidPaise: number;
  /** Total of their shares of expenses. */
  sharePaise: number;
  /** Payments they made to others minus payments they received. */
  settledPaise: number;
  /** paid − share + settled. Positive = the space owes them. */
  netPaise: number;
}

export interface Balances {
  /** The month these balances cover ("YYYY-MM"), or null for all time. */
  month: string | null;
  simplified: boolean;
  members: MemberBalance[];
  transfers: Transfer[];
}

/** One row of a recurring space's month-by-month sheet. */
export interface MonthSummary {
  month: string;
  spentPaise: number;
  expenseCount: number;
  /** Money still to move for that month once its recorded payments are counted. */
  outstandingPaise: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
