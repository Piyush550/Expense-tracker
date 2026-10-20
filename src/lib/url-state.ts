// Navigation state lives in the URL (?s=space&t=groups&m=month, ?v=account) so links and
// reloads keep it, and Back works.
import { useCallback, useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

/** Sets several params in one history entry. null removes a param. */
export function setParams(patch: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  window.history.pushState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useSearchParam(name: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.search).get(name));
  const set = useCallback((next: string | null) => setParams({ [name]: next }), [name]);
  return [value, set];
}
