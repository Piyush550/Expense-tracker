// Browser-only drafts. Each row owns its payer, people and split; keys remain expense IDs.
import type { SplitType } from "../../shared/split";
import type { SelectedSplitGroup, SplitSelection } from "./split-draft";

export interface DraftRow extends SplitSelection {
  key: string;
  description: string;
  amount: string;
  payerId: string;
}
export interface Draft {
  version: 2;
  date: string;
  payerId: string;
  rows: DraftRow[];
  savedAt: number;
}
const key = (userId: string, spaceId: string) => `expense-tracker:draft:${userId}:${spaceId}`;
export const blankRow = (payerId: string, people: string[]): DraftRow => ({ key: crypto.randomUUID(), description: "", amount: "", payerId, people: [...people], splitType: "equal", values: {} });
export const rowHasContent = (row: DraftRow) => row.description.trim() !== "" || row.amount.trim() !== "";
const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every((id) => typeof id === "string");

export function loadDraft(userId: string, spaceId: string): Draft | null {
  try {
    const raw = localStorage.getItem(key(userId, spaceId));
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (!stored || !Array.isArray(stored.rows) || typeof stored.date !== "string" || typeof stored.payerId !== "string") return null;
    // Resolve older global defaults once, preserving row UUIDs, payer overrides and participants.
    const rows: DraftRow[] = stored.rows.map((row: Record<string, unknown>) => {
      if (!row || typeof row.key !== "string" || typeof row.description !== "string" || typeof row.amount !== "string") throw new Error("Invalid draft row");
      const type: SplitType = ["equal", "exact", "percent", "shares"].includes(String(row.splitType)) ? row.splitType as SplitType : "equal";
      const values = row.values && typeof row.values === "object" && !Array.isArray(row.values)
        ? Object.fromEntries(Object.entries(row.values).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
      const selectedGroups: SelectedSplitGroup[] = Array.isArray(row.selectedGroups) ? row.selectedGroups.flatMap((group: unknown) => {
        if (!group || typeof group !== "object") return [];
        const item = group as Record<string, unknown>;
        return typeof item.id === "string" && typeof item.name === "string" && isIds(item.people)
          ? [{ id: item.id, name: item.name, people: [...new Set(item.people)] }] : [];
      }) : [];
      const participants: string[] = isIds(row.people) ? row.people : isIds(stored.people) ? stored.people : [];
      const people = [...new Set(participants)];
      const groupPeople = new Set(selectedGroups.flatMap((group) => group.people));
      // If a draft was customised or metadata is inconsistent, retain its explicit people.
      const groupsMatch = people.length === groupPeople.size && people.every((id) => groupPeople.has(id));
      return { key: row.key, description: row.description, amount: row.amount,
        payerId: typeof row.payerId === "string" ? row.payerId : stored.payerId,
        people, splitType: type, values, ...(selectedGroups.length && groupsMatch ? { selectedGroups } : {}) };
    });
    return { version: 2, date: stored.date, payerId: stored.payerId, rows, savedAt: typeof stored.savedAt === "number" ? stored.savedAt : Date.now() };
  } catch { return null; }
}
export function saveDraft(userId: string, spaceId: string, draft: Draft) {
  try {
    if (draft.rows.some(rowHasContent)) localStorage.setItem(key(userId, spaceId), JSON.stringify(draft));
    else localStorage.removeItem(key(userId, spaceId));
  } catch { /* Storage unavailable: keep this session's draft. */ }
}
export function clearDraft(userId: string, spaceId: string) {
  try { localStorage.removeItem(key(userId, spaceId)); } catch { /* No persisted draft. */ }
}
