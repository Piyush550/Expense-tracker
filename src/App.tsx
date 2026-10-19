import { useState } from "react";
import { currentMonth, MONTH_RE } from "../shared/dates";
import { errorMessage } from "./lib/api";
import { useAuth } from "./lib/auth";
import { useMe, useSpace, useSpaces } from "./lib/queries";
import { setParams, useSearchParam } from "./lib/url-state";
import { Account } from "./components/Account";
import { AuthScreen, VerifyEmailScreen } from "./components/AuthScreen";
import { GroupsPage } from "./components/GroupsPage";
import { Header } from "./components/Header";
import { NewSpaceForm } from "./components/NewSpaceForm";
import { SpaceNav } from "./components/SpaceNav";
import { SPACE_TABS, SpaceView, type SpaceTab } from "./components/SpaceView";

const TAGLINE = "Split shared expenses and settle up with the fewest payments";

export function App() {
  const { status } = useAuth();
  if (status === "ready") return <SignedIn />;
  return (
    <div className="wrap">
      <Header subtitle={TAGLINE} />
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

// URL: ?s=<space>&t=<tab>&m=<YYYY-MM|all>, or ?v=groups for the groups page.
function SignedIn() {
  const me = useMe();
  const spaces = useSpaces();
  const [view] = useSearchParam("v");
  const [spaceParam] = useSearchParam("s");
  const [tabParam, setTabParam] = useSearchParam("t");
  const [monthParam, setMonthParam] = useSearchParam("m");
  const [creating, setCreating] = useState(false);

  const list = spaces.data ?? [];
  const spaceId = list.some((s) => s.id === spaceParam) ? spaceParam : (list[0]?.id ?? null);
  const spaceQuery = useSpace(spaceId);
  const space = spaceId && spaceQuery.data?.id === spaceId ? spaceQuery.data : null;
  const tab: SpaceTab = SPACE_TABS.some((t) => t.id === tabParam) ? (tabParam as SpaceTab) : "expenses";
  // Recurring spaces default to this month; one-time spaces always look at everything.
  const month = space?.kind !== "recurring" ? null : monthParam === "all" ? null : monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth();
  const onGroups = view === "groups";

  const error = me.error ?? spaces.error;
  const select = (id: string) => {
    setCreating(false);
    setParams({ v: null, s: id, m: null });
  };

  return (
    <div className="wrap">
      <Header subtitle={TAGLINE} />
      {error && <div className="banner warn">{errorMessage(error)}</div>}
      {(me.isPending || spaces.isPending) && !error ? (
        <div className="card muted">Loading your spaces…</div>
      ) : me.data && spaces.data ? (
        <>
          <SpaceNav
            spaces={list}
            selected={spaceId}
            onSelect={select}
            onNew={() => { setParams({ v: null }); setCreating(true); }}
            onGroups={() => { setCreating(false); setParams({ v: "groups" }); }}
            groupsActive={onGroups}
          />
          {onGroups ? (
            <GroupsPage meId={me.data.id} />
          ) : creating || !list.length ? (
            <>
              {!list.length && (
                <div className="card">
                  <h3 style={{ fontSize: 20 }}>Start your first space</h3>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    A space is where shared costs live: your flat's monthly groceries, or a one-off trip. If someone already added you to a space, it appears here as soon as you sign in with the email they used.
                  </p>
                </div>
              )}
              <NewSpaceForm onCancel={list.length ? () => setCreating(false) : undefined} onDone={(s) => select(s.id)} />
            </>
          ) : space ? (
            <SpaceView
              key={space.id}
              space={space}
              updatedAt={spaceQuery.dataUpdatedAt}
              me={me.data}
              tab={tab}
              onTab={(t) => setTabParam(t === "expenses" ? null : t)}
              month={month}
              onMonth={(m) => setMonthParam(m ?? "all")}
              onLeave={() => setParams({ s: null, t: null, m: null })}
            />
          ) : (
            <div className="card muted">Loading the space…</div>
          )}
          <Account me={me.data} />
        </>
      ) : null}
    </div>
  );
}
