// Server state lives in TanStack Query. Every write invalidates the space it touched, and
// open screens refetch on focus and every 30 s so other people's changes show up.
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

/** `month` undefined means "all time". */
export const keys = {
  me: ["me"] as const,
  spaces: ["spaces"] as const,
  groups: ["groups"] as const,
  space: (id: string) => ["space", id] as const,
  balances: (id: string, month?: string) => ["space", id, "balances", month ?? "all"] as const,
  months: (id: string) => ["space", id, "months"] as const,
  expenses: (id: string, month?: string) => ["space", id, "expenses", month ?? "all"] as const,
  settlements: (id: string, month?: string) => ["space", id, "settlements", month ?? "all"] as const,
};

const LIVE = { refetchInterval: 30_000, refetchIntervalInBackground: false };

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me });
export const useSpaces = () => useQuery({ queryKey: keys.spaces, queryFn: api.spaces, ...LIVE });
export const useGroups = () => useQuery({ queryKey: keys.groups, queryFn: api.groups });
export const useSpace = (id: string | null) =>
  useQuery({ queryKey: keys.space(id ?? ""), queryFn: () => api.space(id!), enabled: !!id, ...LIVE });
export const useBalances = (id: string, month?: string) =>
  useQuery({ queryKey: keys.balances(id, month), queryFn: () => api.balances(id, month), ...LIVE });
export const useMonths = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.months(id), queryFn: () => api.months(id), enabled, ...LIVE });
export const useExpenses = (id: string, month?: string) =>
  useQuery({ queryKey: keys.expenses(id, month), queryFn: () => api.expenses(id, month), ...LIVE });
export const useSettlements = (id: string, month?: string) =>
  useQuery({ queryKey: keys.settlements(id, month), queryFn: () => api.settlements(id, month), ...LIVE });

/** A mutation that refreshes everything about `spaceId` (and the space list) when it settles. */
export function useSpaceMutation<V, R>(spaceId: string | null, fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.spaces }),
        spaceId ? qc.invalidateQueries({ queryKey: keys.space(spaceId) }) : Promise.resolve(),
      ]);
    },
  });
}

export function useGroupMutation<V, R>(fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: keys.groups }) });
}
