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

/** Public registered-user directory: no email addresses or authentication identifiers. */
export type DirectoryPerson = Pick<Person, "id" | "name">;
export interface DirectoryPage {
  people: DirectoryPerson[];
  total: number;
  limit: number;
  offset: number;
}

export interface PersonInvite {
  name: string;
  email: string;
}

/** Existing contacts, registered directory entries, and named invitations. */
export interface PeopleInput {
  memberIds: string[];
  directoryIds: string[];
  memberInvites: PersonInvite[];
}

/** A list of current people belonging to exactly one space. */
export interface Group {
  id: string;
  spaceId: string;
  /** UTC ISO timestamp with six fractional digits, preserving creation order within a millisecond. */
  createdAt: string;
  name: string;
  createdBy: string;
  /** Space owners manage the groups in their space. */
  canEdit: boolean;
  members: Person[];
}

export type SpaceQuickActions = { mode: "automatic" } | { mode: "custom"; groupIds: string[] };
export interface InitialSpaceGroup { id: string; name: string; memberIds: string[] }

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

/** A personal token as listed in the app. The secret itself is only ever returned once. */
export interface ApiToken {
  id: string;
  name: string;
  /** Last 4 characters of the secret, to tell tokens apart. */
  hint: string;
  /** null = never expires. */
  lifetimeDays: number | null;
  createdAt: string;
  /** When the current secret was made (creation or last regenerate). */
  rotatedAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
}

/** Returned by create and regenerate: the only time the secret is visible. */
export interface NewApiToken {
  token: string;
  info: ApiToken;
}

/** One "space + who splits" choice for the phone shortcut. Always an equal split, paid by you. */
export interface QuickPreset {
  /** "<spaceId>.all" or "<spaceId>.<groupId>". */
  id: string;
  /** "Flat 4B · Everyone". Unique per user, so the shortcut can send it back as-is. */
  label: string;
  spaceId: string;
  spaceName: string;
  groupId: string | null;
  people: { id: string; name: string }[];
}

export interface QuickOptions {
  /** Labels in display order, for the shortcut's "Choose from List". */
  labels: string[];
  presets: QuickPreset[];
}

export interface QuickExpenseInput {
  /** A preset id or its label. */
  preset: string;
  /** Rupees, e.g. 450 or "450.50". */
  amount: number | string;
  title?: string;
  /** "2026-10-21", "today", "yesterday", "21 Oct". Defaults to today (India time). */
  date?: string;
  /** Optional UUID; sending the same one again cannot create a duplicate. */
  requestId?: string;
}

export interface QuickExpenseResult {
  /** Ready to show in the phone notification. */
  message: string;
  expense: Expense;
}

/** One page of a space's expenses, with the count and totals of every match (MCP listing). */
export interface ExpensePage {
  total: number;
  totalPaise: number;
  /** The `involving` person's share across every match; null without that filter. */
  sharePaise: number | null;
  items: Expense[];
}

/** One page of a space's payments, with the count and total of every match. */
export interface SettlementPage {
  total: number;
  totalPaise: number;
  items: Settlement[];
}
