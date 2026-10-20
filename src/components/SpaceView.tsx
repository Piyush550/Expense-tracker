import { useMemo } from "react";
import type { Me, SpaceDetail } from "../../shared/api";
import { BalancesTab } from "./BalancesTab";
import { ExpensesTab } from "./ExpensesTab";
import { MonthPicker } from "./Header";
import { GroupsPage } from "./GroupsPage";
import { Members } from "./Members";
import { PeopleContext } from "./People";
import { RefreshButton } from "./RefreshButton";
import { QuickActionsTab } from "./QuickActions";
import { SpaceSettings } from "./SpaceSettings";

export type SpaceTab = "expenses" | "balances" | "members" | "groups" | "quick-actions" | "settings";
export const SPACE_TABS: { id: SpaceTab; label: string; shortLabel?: string }[] = [
  { id: "expenses", label: "Expenses" },
  { id: "balances", label: "Balances & settle up", shortLabel: "Balances" },
  { id: "members", label: "Members" },
  { id: "groups", label: "Groups" },
  { id: "quick-actions", label: "Quick actions" },
  { id: "settings", label: "Settings" },
];

export function SpaceView({ space, updatedAt, me, tab, onTab, month, onMonth, onLeave }: {
  space: SpaceDetail;
  /** When the space was last fetched from the server. */
  updatedAt: number;
  me: Me;
  tab: SpaceTab;
  onTab(t: SpaceTab): void;
  /** Selected month for recurring spaces; null = all months (always null for one-time spaces). */
  month: string | null;
  onMonth(m: string | null): void;
  onLeave(): void;
}) {
  const people = useMemo(() => new Map(space.members.map((m) => [m.id, m])), [space.members]);
  const recurring = space.kind === "recurring";
  const active = space.members.filter((m) => m.active).length;
  const showMonths = recurring && (tab === "expenses" || tab === "balances");

  return (
    <PeopleContext.Provider value={people}>
      <div className="spacehead">
        <div>
          <h1 className="spacetitle">{space.name}<span className="kindtag">{recurring ? "Monthly" : "One-time"}</span></h1>
          <p className="sub">
            {active} {active === 1 ? "member" : "members"} · {recurring ? "settled month by month" : "settled once, over everything"}
            {space.myRole === "owner" ? " · you own this space" : ""}
          </p>
        </div>
        <div className="spacetools">
          <RefreshButton spaceId={space.id} updatedAt={updatedAt} />
          {showMonths && <MonthPicker month={month} months={space.months} onChange={onMonth} allowAll />}
        </div>
      </div>

      <div className="subtabs" role="tablist" aria-label={`${space.name} sections`}>
        {SPACE_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-label={t.label} aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => onTab(t.id)}>
            <span className={t.shortLabel ? "tab-full" : undefined}>{t.label}</span>
            {t.shortLabel && <span className="tab-short" aria-hidden="true">{t.shortLabel}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="tabpanel">
        {tab === "expenses" && <ExpensesTab space={space} me={me} month={month} />}
        {tab === "balances" && <BalancesTab space={space} me={me} month={month} onMonth={onMonth} />}
        {tab === "members" && <Members space={space} meId={me.id} onLeft={onLeave} />}
        {tab === "groups" && <GroupsPage space={space} meId={me.id} />}
        {tab === "quick-actions" && <QuickActionsTab space={space} />}
        {tab === "settings" && <SpaceSettings key={space.id} space={space} onDeleted={onLeave} />}
      </div>
    </PeopleContext.Provider>
  );
}
