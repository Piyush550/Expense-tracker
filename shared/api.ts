// Request and response shapes shared by the API (server/) and the app (src/).
import type { SplitType } from "./split";
import type { Transfer } from "./settlement";

export type Role = "owner" | "member";

export interface Me {
  id: string;
  name: string;
  email: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  memberCount: number;
  /** The signed-in user's net balance in this group (positive = is owed). */
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

export interface GroupDetail {
  id: string;
  name: string;
  simplifyDebts: boolean;
  myRole: Role;
  members: Member[];
  /** Months ("YYYY-MM") that have expenses or payments, newest first. */
  months: string[];
}

export interface ExpenseShare {
  userId: string;
  sharePaise: number;
  splitValue: number | null;
}

export interface Expense {
  id: string;
  groupId: string;
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
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountPaise: number;
  paidOn: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface SettlementInput {
  fromUserId: string;
  toUserId: string;
  amountPaise: number;
  paidOn: string;
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
  /** paid − share + settled. Positive = the group owes them. */
  netPaise: number;
}

export interface Balances {
  simplified: boolean;
  members: MemberBalance[];
  transfers: Transfer[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
