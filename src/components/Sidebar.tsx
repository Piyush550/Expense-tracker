import { useState } from "react";
import type { Me, SpaceSummary } from "../../shared/api";
import { formatMoney } from "../../shared/money";
import { AccountMenu, type SettingsTab } from "./AccountMenu";
import { Brand } from "./Header";

export function Sidebar({ me, spaces, selected, view, onSpace, onNewSpace, onAccount }: {
  me: Me | undefined;
  spaces: SpaceSummary[];
  selected: string | null;
  /** What the main area shows: a space, the account page or the new-space form. */
  view: "space" | "account" | "new";
  onSpace(id: string): void;
  onNewSpace(): void;
  /** Opens Settings at a tab. */
  onAccount(tab: SettingsTab): void;
}) {
  // Phones: spaces stay visible as a strip; the account menu folds into the Menu button.
  const [menu, setMenu] = useState(false);
  const go = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  return (
    <aside className={`sidebar${menu ? " open" : ""}`}>
      <div className="sidetop">
        <Brand />
        <button type="button" className="menubtn btn small" aria-expanded={menu} aria-controls="side-more" onClick={() => setMenu(!menu)}>
          {menu ? "Close" : "Menu"}
        </button>
      </div>
      <nav className="sidenav spaces" aria-label="Spaces">
        <div className="sidelabel">Spaces</div>
        {spaces.map((s) => {
          const on = view === "space" && s.id === selected;
          const b = s.myBalancePaise;
          return (
            <button key={s.id} type="button" className={`sidelink${on ? " on" : ""}`} aria-current={on ? "page" : undefined} onClick={go(() => onSpace(s.id))}>
              <span className="stack">
                <strong>{s.name}</strong>
                <span>{s.kind === "recurring" ? "Monthly" : "One-time"} · {s.memberCount} {s.memberCount === 1 ? "member" : "members"}</span>
              </span>
              {b !== 0 && <span className={`bal ${b > 0 ? "pos" : "neg"}`} title={b > 0 ? "You are owed" : "You owe"}>{b > 0 ? "+" : ""}{formatMoney(b)}</span>}
            </button>
          );
        })}
        <button type="button" className="sidenew" onClick={go(onNewSpace)}>+ New space</button>
      </nav>

      <div id="side-more" className="sidemore">
      <div className="sidefoot">
        {me && <AccountMenu me={me} active={view === "account"} onOpen={(tab) => { setMenu(false); onAccount(tab); }} />}
      </div>
      </div>
    </aside>
  );
}
