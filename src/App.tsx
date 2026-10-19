import { useState } from "react";
import { currentMonth, MONTH_RE } from "../shared/dates";
import { errorMessage } from "./lib/api";
import { useAuth } from "./lib/auth";
import { useGroup, useGroups, useMe } from "./lib/queries";
import { useSearchParam } from "./lib/url-state";
import { Account } from "./components/Account";
import { AuthScreen, VerifyEmailScreen } from "./components/AuthScreen";
import { GroupTabs } from "./components/GroupTabs";
import { GroupView } from "./components/GroupView";
import { Header } from "./components/Header";
import { NewGroupForm } from "./components/NewGroupForm";

export function App() {
  const { status } = useAuth();
  if (status === "ready") return <SignedIn />;
  return (
    <div className="wrap">
      <Header subtitle="Split shared expenses and settle up with the fewest payments" />
      {status === "loading" ? (
        <div className="card authcard muted">Checking your sign-in…</div>
      ) : status === "unverified" ? (
        <VerifyEmailScreen />
      ) : (
        <AuthScreen />
      )}
    </div>
  );
}

function SignedIn() {
  const me = useMe();
  const groups = useGroups();
  const [groupParam, setGroupParam] = useSearchParam("g");
  const [monthParam, setMonthParam] = useSearchParam("m");
  const [creating, setCreating] = useState(false);

  const list = groups.data ?? [];
  const groupId = list.some((g) => g.id === groupParam) ? groupParam : (list[0]?.id ?? null);
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth();
  const group = useGroupOrNull(groupId);

  const error = me.error ?? groups.error;
  const subtitle = group ? `${group.name} · ${group.members.filter((m) => m.active).length} members · amounts in ₹` : "Split shared expenses and settle up with the fewest payments";

  return (
    <div className="wrap">
      <Header subtitle={subtitle} nav={group ? { month, months: group.months, onChange: setMonthParam } : undefined} />
      {error && <div className="banner warn">{errorMessage(error)}</div>}
      {(me.isPending || groups.isPending) && !error ? (
        <div className="card muted">Loading your groups…</div>
      ) : me.data && groups.data ? (
        <>
          {list.length > 0 && (
            <GroupTabs groups={list} selected={groupId} onSelect={(id) => { setCreating(false); setGroupParam(id); }} onNew={() => setCreating(true)} />
          )}
          {creating || !list.length ? (
            <>
              {!list.length && (
                <div className="card">
                  <h3 style={{ fontSize: 20 }}>Start your first group</h3>
                  <p className="muted" style={{ margin: "6px 0 0" }}>A group is the set of people you share costs with: your flat, a trip, the office lunch crowd. If someone already added you to a group, it will appear here as soon as you sign in with the email they used.</p>
                </div>
              )}
              <NewGroupForm onCancel={list.length ? () => setCreating(false) : undefined} onDone={(g) => { setCreating(false); setGroupParam(g.id); }} />
            </>
          ) : group ? (
            <GroupView key={group.id} group={group} me={me.data} month={month} onLeave={() => setGroupParam(null)} />
          ) : (
            <div className="card muted">Loading the group…</div>
          )}
          <Account me={me.data} />
        </>
      ) : null}
    </div>
  );
}

function useGroupOrNull(id: string | null) {
  const q = useGroup(id);
  return id && q.data?.id === id ? q.data : null;
}
