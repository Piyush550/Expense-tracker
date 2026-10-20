import { formatMoney, paiseToInput, parseMoney } from "../../shared/money";
import { computeShares, PERCENT_TOTAL, SplitError, type SplitInput, type SplitType } from "../../shared/split";

/** Browser-only provenance. Saved expenses always contain explicit people and shares. */
export interface SelectedSplitGroup { id: string; name: string; people: string[] }
export interface SplitGroup { id: string; name: string; ids: string[]; total: number }
export interface SplitSelection {
  people: string[];
  splitType: SplitType;
  values: Record<string, string>;
  selectedGroups?: SelectedSplitGroup[];
}

/** Recompute from the selected group snapshots, so overlaps never duplicate a person. */
export function toggleSplitGroup(selection: SplitSelection, group: SplitGroup): SplitSelection {
  const current = selection.selectedGroups ?? [];
  if (!group.ids.length && !current.some((item) => item.id === group.id)) return selection;
  const selectedGroups = current.some((item) => item.id === group.id)
    ? current.filter((item) => item.id !== group.id)
    : [...current, { id: group.id, name: group.name, people: [...new Set(group.ids)] }];
  const people = [...new Set(selectedGroups.flatMap((item) => item.people))];
  // Keep custom values, including temporarily removed people, rather than overwriting them.
  const values = { ...selection.values };
  for (const id of people) values[id] ??= selection.splitType === "shares" ? "1" : "";
  return { ...selection, people, values, selectedGroups };
}

export function copySelectedGroups(selection: SplitSelection): SelectedSplitGroup[] {
  return (selection.selectedGroups ?? []).map((group) => ({ ...group, people: [...group.people] }));
}

export const SPLIT_TYPES: { type: SplitType; label: string }[] = [
  { type: "equal", label: "Equal" }, { type: "exact", label: "Amounts" },
  { type: "percent", label: "Percent" }, { type: "shares", label: "Shares" },
];

export function parseSplitValue(type: SplitType, text: string): number | null {
  const value = text.trim().replace(/[,\s₹%]/g, "");
  if (!value) return 0;
  if (type === "exact") return /^0+(\.0{1,2})?$/.test(value) ? 0 : parseMoney(value);
  if (type === "percent") {
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
    const points = Math.round(Number(value) * 100);
    return points <= PERCENT_TOTAL ? points : null;
  }
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}

export function splitValueText(type: SplitType, value: number | null): string {
  if (value == null) return "";
  return type === "exact" ? paiseToInput(value) : type === "percent" ? String(value / 100) : String(value);
}

export function initialSplitValues(type: SplitType, ids: string[], amount: number | null, seed: string): Record<string, string> {
  if (type === "exact") return Object.fromEntries(amount && ids.length
    ? computeShares(amount, "equal", ids.map((userId) => ({ userId })), seed).map((share) => [share.userId, paiseToInput(share.sharePaise)]) : []);
  if (type === "percent" && ids.length) {
    const each = Math.floor(PERCENT_TOTAL / ids.length);
    return Object.fromEntries(ids.map((id, index) => [id, String((each + (index < PERCENT_TOTAL % ids.length ? 1 : 0)) / 100)]));
  }
  return Object.fromEntries(ids.map((id) => [id, type === "shares" ? "1" : ""]));
}

export function previewSplit(amount: number | null, type: SplitType, ids: string[], values: Record<string, string>, seed: string) {
  const splits: SplitInput[] = [];
  for (const userId of ids) {
    const value = type === "equal" ? undefined : parseSplitValue(type, values[userId] ?? "");
    if (value === null) return { splits, shares: null, problem: "Check the highlighted split values.", assigned: 0 };
    splits.push(type === "equal" ? { userId } : { userId, value });
  }
  const assigned = splits.reduce((sum, split) => sum + (split.value ?? 0), 0);
  if (!ids.length) return { splits, shares: null, problem: "Pick at least one person to split between.", assigned };
  if (!amount) return { splits, shares: null, problem: "", assigned };
  try {
    return { splits, shares: new Map(computeShares(amount, type, splits, seed).map((share) => [share.userId, share.sharePaise])), problem: "", assigned };
  } catch (error) {
    return { splits, shares: null, problem: error instanceof SplitError ? error.message : "Check the split.", assigned };
  }
}

export function splitFeedback(type: SplitType, amount: number | null, preview: ReturnType<typeof previewSplit>) {
  if (preview.problem) return preview.problem;
  if (!amount) return "Enter an amount to preview the split.";
  if (type === "percent") return "100% assigned · All set";
  return `${formatMoney(amount)} assigned · All set`;
}
