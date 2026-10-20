import type { Group, SpaceQuickActions } from "./api";

/** Explicit order when configured; otherwise newest createdAt, with a stable id tie break. */
export function quickActionGroups(groups: Group[], config: SpaceQuickActions): Group[] {
  if (config.mode === "custom") {
    const byId = new Map(groups.map((group) => [group.id, group]));
    const selected = [...new Set(config.groupIds)].flatMap((id) => byId.has(id) ? [byId.get(id)!] : []).slice(0, 3);
    if (selected.length) return selected;
  }
  // The API supplies canonical UTC timestamps with microseconds. Date.parse would lose
  // precision when onboarding creates several groups in the same millisecond.
  return [...groups].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0, 3);
}
