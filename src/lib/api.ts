// Typed calls to /api. Every request carries the Firebase ID token; a 401 retries once
// with a freshly minted token (e.g. right after the email was verified).
import type {
  DirectoryPage, ApiErrorBody, Balances, Expense, ExpenseInput, Group, Me, MonthSummary, Person, PeopleInput, Role, Settlement, SettlementInput, SpaceDetail,
  SpaceKind, SpaceSummary, InitialSpaceGroup, SpaceQuickActions, ApiToken, NewApiToken,
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

  // Personal tokens for the iPhone shortcut.
  tokens: () => request<ApiToken[]>("GET", "/tokens"),
  createToken: (name: string, lifetimeDays: number | null) => request<NewApiToken>("POST", "/tokens", { name, lifetimeDays }),
  regenerateToken: (id: string) => request<NewApiToken>("POST", `/tokens/${id}/regenerate`),
  updateToken: (id: string, patch: { name?: string; lifetimeDays?: number | null }) => request<ApiToken>("PATCH", `/tokens/${id}`, patch),
  revokeToken: (id: string) => request<ApiToken>("POST", `/tokens/${id}/revoke`),
  deleteToken: (id: string) => request<void>("DELETE", `/tokens/${id}`),
  updateMe: (name: string) => request<Me>("PATCH", "/me", { name }),

  spaces: () => request<SpaceSummary[]>("GET", "/spaces"),
  space: (id: string) => request<SpaceDetail>("GET", `/spaces/${id}`),
  people: () => request<Person[]>("GET", "/people"),
  directory: () => request<Person[]>("GET", "/people/directory"),
  directoryPage: (search: string, limit: number, offset: number) =>
    request<DirectoryPage>("GET", `/people/directory/page?${new URLSearchParams({ search, limit: String(limit), offset: String(offset) })}`),

  createSpace: (input: { name: string; kind: SpaceKind; initialGroups?: InitialSpaceGroup[]; quickGroupIds?: string[]; memberEmails?: string[] } & PeopleInput) =>
    request<SpaceDetail>("POST", "/spaces", input),
  updateSpace: (id: string, patch: { name?: string; kind?: SpaceKind; simplifyDebts?: boolean }) =>
    request<SpaceDetail>("PATCH", `/spaces/${id}`, patch),
  deleteSpace: (id: string) => request<void>("DELETE", `/spaces/${id}`),

  addMember: (spaceId: string, who: { userId: string } | { email: string }) => request<SpaceDetail>("POST", `/spaces/${spaceId}/members`, who),
  addMembers: (spaceId: string, people: PeopleInput) => request<SpaceDetail>("POST", `/spaces/${spaceId}/members`, people),
  setRole: (spaceId: string, userId: string, role: Role) => request<SpaceDetail>("PATCH", `/spaces/${spaceId}/members/${userId}`, { role }),
  removeMember: (spaceId: string, userId: string) => request<void>("DELETE", `/spaces/${spaceId}/members/${userId}`),
  mergeMember: (spaceId: string, userId: string, intoUserId: string) =>
    request<SpaceDetail>("POST", `/spaces/${spaceId}/members/${userId}/merge`, { intoUserId }),

  balances: (spaceId: string, month?: string) => request<Balances>("GET", `/spaces/${spaceId}/balances${q(month)}`),
  months: (spaceId: string) => request<MonthSummary[]>("GET", `/spaces/${spaceId}/months`),

  expenses: (spaceId: string, month?: string) => request<Expense[]>("GET", `/spaces/${spaceId}/expenses${q(month)}`),
  createExpense: (spaceId: string, id: string, input: ExpenseInput) => request<Expense>("POST", `/spaces/${spaceId}/expenses`, { id, ...input }),
  /** Saves all of them or none (one transaction). A failing row is named in the error's details.index. */
  bulkCreateExpenses: (spaceId: string, expenses: (ExpenseInput & { id: string })[]) =>
    request<{ expenses: Expense[] }>("POST", `/spaces/${spaceId}/expenses/bulk`, { expenses }),
  updateExpense: (id: string, version: number, input: ExpenseInput) => request<Expense>("PATCH", `/expenses/${id}`, { version, ...input }),
  deleteExpense: (id: string) => request<void>("DELETE", `/expenses/${id}`),

  settlements: (spaceId: string, month?: string) => request<Settlement[]>("GET", `/spaces/${spaceId}/settlements${q(month)}`),
  createSettlement: (spaceId: string, id: string, input: SettlementInput) =>
    request<Settlement>("POST", `/spaces/${spaceId}/settlements`, { id, ...input }),
  deleteSettlement: (id: string) => request<void>("DELETE", `/settlements/${id}`),

  groups: (spaceId: string) => request<Group[]>("GET", `/spaces/${spaceId}/groups`),
  createGroup: (spaceId: string, name: string, memberIds: string[]) => request<Group>("POST", `/spaces/${spaceId}/groups`, { name, memberIds }),
  updateGroup: (spaceId: string, id: string, patch: { name?: string; memberIds?: string[] }) => request<Group>("PATCH", `/spaces/${spaceId}/groups/${id}`, patch),
  deleteGroup: (spaceId: string, id: string) => request<void>("DELETE", `/spaces/${spaceId}/groups/${id}`),
  quickActions: (spaceId: string) => request<SpaceQuickActions>("GET", `/spaces/${spaceId}/quick-actions`),
  saveQuickActions: (spaceId: string, config: SpaceQuickActions) => request<SpaceQuickActions>("PUT", `/spaces/${spaceId}/quick-actions`, config),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again.";
}
