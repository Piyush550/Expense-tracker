// Typed calls to /api. Every request carries the Firebase ID token; a 401 retries once
// with a freshly minted token (e.g. right after the email was verified).
import type {
  ApiErrorBody, Balances, Expense, ExpenseInput, GroupDetail, GroupSummary, Me, Role, Settlement, SettlementInput,
} from "../../shared/api";
import { auth } from "./firebase";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, "unauthorized", "Sign in to continue.");
  const send = async (fresh: boolean) =>
    fetch(`/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await user.getIdToken(fresh)}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let res: Response;
  try {
    res = await send(false);
    if (res.status === 401) res = await send(true);
  } catch {
    throw new ApiError(0, "network", "No connection. Check your internet and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? "Something went wrong. Try again.", err?.details);
  }
  return data as T;
}

const q = (month?: string) => (month ? `?month=${encodeURIComponent(month)}` : "");

export const api = {
  me: () => request<Me>("GET", "/me"),
  updateMe: (name: string) => request<Me>("PATCH", "/me", { name }),

  groups: () => request<GroupSummary[]>("GET", "/groups"),
  group: (id: string) => request<GroupDetail>("GET", `/groups/${id}`),
  createGroup: (name: string, memberEmails: string[]) => request<GroupDetail>("POST", "/groups", { name, memberEmails }),
  updateGroup: (id: string, patch: { name?: string; simplifyDebts?: boolean }) => request<GroupDetail>("PATCH", `/groups/${id}`, patch),
  deleteGroup: (id: string) => request<void>("DELETE", `/groups/${id}`),

  addMember: (groupId: string, email: string, name?: string) =>
    request<GroupDetail>("POST", `/groups/${groupId}/members`, name ? { email, name } : { email }),
  setRole: (groupId: string, userId: string, role: Role) => request<GroupDetail>("PATCH", `/groups/${groupId}/members/${userId}`, { role }),
  removeMember: (groupId: string, userId: string) => request<void>("DELETE", `/groups/${groupId}/members/${userId}`),
  mergeMember: (groupId: string, userId: string, intoUserId: string) =>
    request<GroupDetail>("POST", `/groups/${groupId}/members/${userId}/merge`, { intoUserId }),

  balances: (groupId: string) => request<Balances>("GET", `/groups/${groupId}/balances`),

  expenses: (groupId: string, month?: string) => request<Expense[]>("GET", `/groups/${groupId}/expenses${q(month)}`),
  createExpense: (groupId: string, id: string, input: ExpenseInput) => request<Expense>("POST", `/groups/${groupId}/expenses`, { id, ...input }),
  updateExpense: (id: string, version: number, input: ExpenseInput) => request<Expense>("PATCH", `/expenses/${id}`, { version, ...input }),
  deleteExpense: (id: string) => request<void>("DELETE", `/expenses/${id}`),

  settlements: (groupId: string, month?: string) => request<Settlement[]>("GET", `/groups/${groupId}/settlements${q(month)}`),
  createSettlement: (groupId: string, id: string, input: SettlementInput) =>
    request<Settlement>("POST", `/groups/${groupId}/settlements`, { id, ...input }),
  deleteSettlement: (id: string) => request<void>("DELETE", `/settlements/${id}`),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again.";
}
