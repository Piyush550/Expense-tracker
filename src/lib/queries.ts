// Server state lives in TanStack Query. Every write invalidates the group it touched, and
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

export const keys = {
  me: ["me"] as const,
  groups: ["groups"] as const,
  group: (id: string) => ["group", id] as const,
  balances: (id: string) => ["group", id, "balances"] as const,
  expenses: (id: string, month?: string) => ["group", id, "expenses", month ?? "all"] as const,
  settlements: (id: string, month?: string) => ["group", id, "settlements", month ?? "all"] as const,
};

const LIVE = { refetchInterval: 30_000, refetchIntervalInBackground: false };

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me });
export const useGroups = () => useQuery({ queryKey: keys.groups, queryFn: api.groups, ...LIVE });
export const useGroup = (id: string | null) =>
  useQuery({ queryKey: keys.group(id ?? ""), queryFn: () => api.group(id!), enabled: !!id, ...LIVE });
export const useBalances = (id: string) => useQuery({ queryKey: keys.balances(id), queryFn: () => api.balances(id), ...LIVE });
export const useExpenses = (id: string, month: string) =>
  useQuery({ queryKey: keys.expenses(id, month), queryFn: () => api.expenses(id, month), ...LIVE });
export const useSettlements = (id: string, month: string) =>
  useQuery({ queryKey: keys.settlements(id, month), queryFn: () => api.settlements(id, month), ...LIVE });

/** A mutation that refreshes everything about `groupId` (and the group list) when it settles. */
export function useGroupMutation<V, R>(groupId: string | null, fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.groups }),
        groupId ? qc.invalidateQueries({ queryKey: keys.group(groupId) }) : Promise.resolve(),
      ]);
    },
  });
}
