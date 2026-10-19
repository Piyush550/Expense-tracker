import type { SpaceSummary } from "../../shared/api";
import { formatMoney } from "../../shared/money";

export function SpaceNav({ spaces, selected, onSelect, onNew, onGroups, groupsActive }: {
  spaces: SpaceSummary[];
  selected: string | null;
  onSelect(id: string): void;
  onNew(): void;
  onGroups(): void;
  groupsActive: boolean;
}) {
  return (
    <nav className="spacenav" aria-label="Your spaces">
      <div className="grouptabs">
        {spaces.map((s) => {
          const b = s.myBalancePaise;
          const on = !groupsActive && s.id === selected;
          return (
            <button key={s.id} type="button" className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined} onClick={() => onSelect(s.id)}>
              {s.name}
              <span className="kindtag">{s.kind === "recurring" ? "monthly" : "one-time"}</span>
              {b !== 0 && (
                <span className={`bal ${b > 0 ? "pos" : "neg"}`} title={b > 0 ? "You are owed" : "You owe"}>
                  {b > 0 ? "+" : ""}{formatMoney(b)}
                </span>
              )}
            </button>
          );
        })}
        <button type="button" className="btn small" onClick={onNew}>+ New space</button>
      </div>
      <button type="button" className={`tab${groupsActive ? " on" : ""}`} onClick={onGroups} aria-current={groupsActive ? "page" : undefined}>
        Groups
      </button>
    </nav>
  );
}
