// Server state lives in TanStack Query.
//
// Caching: data counts as fresh for 5 minutes, so switching tabs, months or spaces reuses it
// instead of calling the API again. Nothing polls in the background; the Refresh button (and
// coming back online) fetches again. The cache is also saved per user in localStorage, so a
// reload shows the last data instantly. Every write refreshes only what it changed.
import { QueryClient, useIsFetching, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Person, SpaceDetail } from "../../shared/api";
import { api, ApiError } from "./api";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * MINUTE,
      gcTime: DAY, // must be at least the persisted cache's maxAge
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

/** `month` undefined means "all time". */
export const keys = {
  me: ["me"] as const,
  spaces: ["spaces"] as const,
  groups: (id: string) => ["space", id, "groups"] as const,
  quickActions: (id: string) => ["space", id, "quick-actions"] as const,
  people: ["people"] as const,
  tokens: ["tokens"] as const,
  space: (id: string) => ["space", id] as const,
  detail: (id: string) => ["space", id, "detail"] as const,
  balances: (id: string, month?: string) => ["space", id, "balances", month ?? "all"] as const,
  months: (id: string) => ["space", id, "months"] as const,
  expenses: (id: string, month?: string) => ["space", id, "expenses", month ?? "all"] as const,
  settlements: (id: string, month?: string) => ["space", id, "settlements", month ?? "all"] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me });
// Always fresh when opened: "last used" and revocations matter more than saving a call.
export const useTokens = () => useQuery({ queryKey: keys.tokens, queryFn: api.tokens, staleTime: 0 });
export const useSpaces = () => useQuery({ queryKey: keys.spaces, queryFn: api.spaces });
export const useGroups = (id: string | null) => useQuery({ queryKey: keys.groups(id ?? ""), queryFn: () => api.groups(id!), enabled: !!id });
export const useQuickActions = (id: string) => useQuery({ queryKey: keys.quickActions(id), queryFn: () => api.quickActions(id) });
export const usePeople = () => useQuery({ queryKey: keys.people, queryFn: api.people });
export const useDirectoryPage = (search: string, limit: number, offset: number) => useQuery({
  queryKey: [...keys.people, "directory-page", search, limit, offset],
  queryFn: () => api.directoryPage(search, limit, offset),
});
export const useDirectory = () => useQuery({ queryKey: [...keys.people, "directory"], queryFn: api.directory });
export function useSelectablePeople() {
  const contacts = usePeople();
  const directory = useDirectory();
  const map = new Map<string, Person>(contacts.data?.map((p) => [p.id, p]));
  directory.data?.forEach((p) => map.set(p.id, p));
  return {
    data: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)),
    isPending: contacts.isPending || directory.isPending,
    error: directory.error ?? contacts.error,
    refetch: () => Promise.all([contacts.refetch(), directory.refetch()]),
  };
}
export const useSpace = (id: string | null) =>
  useQuery({ queryKey: keys.detail(id ?? ""), queryFn: () => api.space(id!), enabled: !!id });
export const useBalances = (id: string, month?: string) =>
  useQuery({ queryKey: keys.balances(id, month), queryFn: () => api.balances(id, month) });
export const useMonths = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.months(id), queryFn: () => api.months(id), enabled });
export const useExpenses = (id: string, month?: string) =>
  useQuery({ queryKey: keys.expenses(id, month), queryFn: () => api.expenses(id, month) });
export const useSettlements = (id: string, month?: string) =>
  useQuery({ queryKey: keys.settlements(id, month), queryFn: () => api.settlements(id, month) });

/** What a write changed. Only those queries are refetched (and only if on screen; others are marked stale). */
export type Touch = "detail" | "expenses" | "settlements" | "balances" | "months" | "spaces" | "groups" | "quickActions" | "people" | "everything";

function keysFor(spaceId: string | null, touch: Touch): QueryKey[] {
  const s = spaceId ?? "";
  switch (touch) {
    case "detail": return [keys.detail(s)];
    case "expenses": return [["space", s, "expenses"]];
    case "settlements": return [["space", s, "settlements"]];
    case "balances": return [["space", s, "balances"]];
    case "months": return [keys.months(s)];
    case "spaces": return [keys.spaces];
    case "groups": return [keys.groups(s)];
    case "quickActions": return [keys.quickActions(s)];
    case "people": return [keys.people];
    case "everything": return [keys.space(s), keys.spaces, keys.people];
  }
}

export function useSpaceMutation<V, R>(
  spaceId: string | null,
  fn: (vars: V) => Promise<R>,
  touches: Touch[],
  onData?: (result: R, vars: V) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, vars) => onData?.(result, vars),
    onSettled: () =>
      Promise.all(touches.flatMap((t) => keysFor(spaceId, t)).map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

/** Put a fresh SpaceDetail the API returned straight into the cache (no refetch needed). */
export function setSpaceDetail(detail: SpaceDetail) {
  queryClient.setQueryData(keys.detail(detail.id), detail);
}

/** A new expense or payment may add a month to the month picker. */
export function noteMonth(spaceId: string, month: string) {
  queryClient.setQueryData<SpaceDetail>(keys.detail(spaceId), (d) =>
    d && !d.months.includes(month) ? { ...d, months: [...d.months, month].sort().reverse() } : d,
  );
}

/** The Refresh button: refetch everything about this space plus the lists around it. */
export function refreshAll(spaceId: string | null) {
  return Promise.all([
    spaceId ? queryClient.invalidateQueries({ queryKey: keys.space(spaceId) }) : Promise.resolve(),
    queryClient.invalidateQueries({ queryKey: keys.spaces }),
    queryClient.invalidateQueries({ queryKey: keys.people }),
    queryClient.invalidateQueries({ queryKey: keys.me }),
  ]);
}

export const useIsRefreshing = () => useIsFetching() > 0;

// ── Saved cache, one per signed-in user ────────────────────────────────────────────────
const CACHE_VERSION = "v3"; // bump when an API response shape changes
const cacheKey = (uid: string) => `expense-tracker:cache:${uid}`;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined; // blocked storage: the app still works, just without a saved cache
  }
}

/** Restores this user's saved cache and keeps saving changes. Resolves once restored. */
export function startPersistedCache(uid: string): { ready: Promise<void>; stop: () => void } {
  const persister = createSyncStoragePersister({ storage: storage(), key: cacheKey(uid), throttleTime: 2000 });
  const [stop, ready] = persistQueryClient({ queryClient, persister, maxAge: DAY, buster: CACHE_VERSION });
  return { ready: ready.catch(() => undefined), stop };
}

export function clearPersistedCache(uid: string) {
  try {
    storage()?.removeItem(cacheKey(uid));
  } catch {
    /* nothing saved */
  }
}
