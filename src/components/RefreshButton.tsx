import { useEffect, useState } from "react";
import { refreshAll, useIsRefreshing } from "../lib/queries";

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Fetches fresh data for the space. Data is otherwise cached for a few minutes. */
export function RefreshButton({ spaceId, updatedAt }: { spaceId: string | null; updatedAt: number }) {
  const busy = useIsRefreshing();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <button type="button" className="refreshbtn" aria-label={busy ? "Refreshing" : "Refresh"} title={updatedAt > 0 ? `Updated ${ago(updatedAt)}` : "Refresh this space"} onClick={() => void refreshAll(spaceId)} disabled={busy} aria-live="polite">
      <svg className={busy ? "spin" : ""} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
      </svg>
      <span>{busy ? "Refreshing…" : "Refresh"}</span>
      {!busy && updatedAt > 0 && <span className="muted">· updated {ago(updatedAt)}</span>}
    </button>
  );
}
