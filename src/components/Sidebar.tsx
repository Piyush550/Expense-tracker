import { useState } from "react";
import type { Me, SpaceSummary } from "../../shared/api";
import { formatMoney } from "../../shared/money";
import { AccountMenu, type SettingsTab } from "./AccountMenu";
import { Brand } from "./Header";

export function Sidebar({ me, spaces, selected, view, onSpace, onNewSpace, onAccount, onPeople, onDocs }: {
  me: Me | undefined;
  spaces: SpaceSummary[];
  selected: string | null;
  /** What the main area shows: a space, a platform page, or the new-space form. */
  view: "space" | "account" | "new" | "people" | "docs";
  onSpace(id: string): void;
  onNewSpace(): void;
  onPeople(): void;
  onDocs(): void;
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
      <nav className="sidenav" aria-label="Platform"><div className="sidelabel">Discover</div>
        <button type="button" className={`sidelink${view === "people" ? " on" : ""}`} aria-current={view === "people" ? "page" : undefined} onClick={go(onPeople)}>
          <span className="stack"><strong>People</strong><span>Find people on the platform</span></span>
        </button>
        <button type="button" className={`sidelink${view === "docs" ? " on" : ""}`} aria-current={view === "docs" ? "page" : undefined} onClick={go(onDocs)}>
          <span className="stack"><strong>Docs</strong><span>Guides for using Expense Tracker</span></span>
        </button>
      </nav>
      <div className="sidefoot">
        {me && <AccountMenu me={me} active={view === "account"} onOpen={(tab) => { setMenu(false); onAccount(tab); }} />}
      </div>
      </div>
    </aside>
  );
}
