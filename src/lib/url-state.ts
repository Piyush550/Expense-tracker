// The selected group and month live in the URL (?g=…&m=…) so a link or reload keeps them.
import { useCallback, useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

export function useSearchParam(name: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.search).get(name));
  const set = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (next === null) params.delete(name);
      else params.set(name, next);
      const qs = params.toString();
      window.history.pushState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [name],
  );
  return [value, set];
}
