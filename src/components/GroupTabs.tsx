import type { GroupSummary } from "../../shared/api";
import { formatMoney } from "../../shared/money";

export function GroupTabs({ groups, selected, onSelect, onNew }: {
  groups: GroupSummary[];
  selected: string | null;
  onSelect(id: string): void;
  onNew(): void;
}) {
  return (
    <nav className="grouptabs" aria-label="Your groups">
      {groups.map((g) => {
        const b = g.myBalancePaise;
        return (
          <button key={g.id} type="button" className={`tab${g.id === selected ? " on" : ""}`} aria-current={g.id === selected ? "page" : undefined} onClick={() => onSelect(g.id)}>
            {g.name}
            {b !== 0 && (
              <span className={`bal ${b > 0 ? "pos" : "neg"}`} title={b > 0 ? "You are owed" : "You owe"}>
                {b > 0 ? "+" : ""}{formatMoney(b)}
              </span>
            )}
          </button>
        );
      })}
      <button type="button" className="btn small" onClick={onNew}>+ New group</button>
    </nav>
  );
}
