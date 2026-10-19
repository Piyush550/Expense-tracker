import { useState } from "react";
import type { Group, Me, SpaceSummary } from "../../shared/api";
import { formatMoney } from "../../shared/money";
import { useAuth } from "../lib/auth";
import { Brand, ThemeSwitch } from "./Header";

export function Sidebar({ me, spaces, groups, selected, view, onSpace, onNewSpace, onGroups, onAccount }: {
  me: Me | undefined;
  spaces: SpaceSummary[];
  groups: Group[];
  selected: string | null;
  /** What the main area shows: a space, the groups page, the account page or the new-space form. */
  view: "space" | "groups" | "account" | "new";
  onSpace(id: string): void;
  onNewSpace(): void;
  onGroups(): void;
  onAccount(): void;
}) {
  const auth = useAuth();
  // Phones: spaces stay visible as a strip; groups, theme and account fold into the menu.
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
      <nav className="sidenav" aria-label="Groups">
        <div className="sidelabel">Groups</div>
        {groups.map((g) => (
          <button key={g.id} type="button" className="sidelink" onClick={go(onGroups)}>
            <span className="stack"><strong>{g.name}</strong></span>
            <span className="muted" style={{ fontSize: 12 }}>{g.members.length} people</span>
          </button>
        ))}
        <button type="button" className={`sidelink${view === "groups" ? " on" : ""}`} onClick={go(onGroups)}>
          <span className="stack"><strong>{groups.length ? "Manage groups" : "Create a group"}</strong><span>Saved lists of people</span></span>
        </button>
      </nav>

      <div className="sidefoot">
        <ThemeSwitch />
        {me && (
          <>
            <div className="acct">
              <span className="chip" style={{ ["--h" as string]: 152 }} aria-hidden="true">{me.name.trim().slice(0, 2)}</span>
              <span className="stack"><strong>{me.name}</strong><span>{me.email}</span></span>
            </div>
            <div className="acct-links">
              <button type="button" className="linkbtn" onClick={go(onAccount)}>Change my name</button>
              <button type="button" className="linkbtn" onClick={() => auth.signOut()}>Sign out</button>
            </div>
          </>
        )}
      </div>
      </div>
    </aside>
  );
}
