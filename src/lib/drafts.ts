// Bulk-add drafts live only in this browser (localStorage), one per user and space, until
// they are saved to the server or discarded.

export interface DraftRow {
  /** Also the expense id sent to the server, so saving twice cannot create duplicates. */
  key: string;
  description: string;
  amount: string;
  /** null = use the draft's default payer. */
  payerId: string | null;
  /** null = use the draft's default people. */
  people: string[] | null;
}

export interface Draft {
  date: string;
  payerId: string;
  people: string[];
  rows: DraftRow[];
  savedAt: number;
}

const key = (userId: string, spaceId: string) => `expense-tracker:draft:${userId}:${spaceId}`;

export const blankRow = (): DraftRow => ({ key: crypto.randomUUID(), description: "", amount: "", payerId: null, people: null });
export const rowHasContent = (r: DraftRow) => r.description.trim() !== "" || r.amount.trim() !== "";

export function loadDraft(userId: string, spaceId: string): Draft | null {
  try {
    const raw = localStorage.getItem(key(userId, spaceId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return Array.isArray(d.rows) && typeof d.date === "string" ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(userId: string, spaceId: string, draft: Draft) {
  try {
    if (draft.rows.some(rowHasContent)) localStorage.setItem(key(userId, spaceId), JSON.stringify(draft));
    else localStorage.removeItem(key(userId, spaceId));
  } catch {
    /* storage full or blocked: the draft lasts until the page is closed */
  }
}

export function clearDraft(userId: string, spaceId: string) {
  try {
    localStorage.removeItem(key(userId, spaceId));
  } catch {
    /* nothing saved */
  }
}
