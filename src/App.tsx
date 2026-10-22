import { useState } from "react";
import { currentMonth, MONTH_RE } from "../shared/dates";
import { errorMessage } from "./lib/api";
import { useAuth } from "./lib/auth";
import { useMe, useSpace, useSpaces } from "./lib/queries";
import { setParams, useSearchParam } from "./lib/url-state";
import { SettingsPage } from "./components/Account";
import type { SettingsTab } from "./components/AccountMenu";
import { AuthShell } from "./components/AuthScreen";
import { DocsPage } from "./components/DocsPage";
import { PeopleDirectory } from "./components/PeopleDirectory";
import { NewSpaceForm } from "./components/NewSpaceForm";
import { Sidebar } from "./components/Sidebar";
import { SPACE_TABS, SpaceView, type SpaceTab } from "./components/SpaceView";

export function App() {
  const { status } = useAuth();
  return status === "ready" ? <SignedIn /> : <AuthShell status={status} />;
}

// URL: ?s=<space>&t=<tab>&m=<YYYY-MM|all>, ?v=account, ?v=people, or ?v=docs&doc=<guide>.
function SignedIn() {
  const me = useMe();
  const spaces = useSpaces();
  const [view] = useSearchParam("v");
  const [spaceParam] = useSearchParam("s");
  const [tabParam, setTabParam] = useSearchParam("t");
  const [monthParam, setMonthParam] = useSearchParam("m");
  const [settingsParam] = useSearchParam("f");
  const settingsTab: SettingsTab = settingsParam === "appearance" || settingsParam === "shortcut" ? settingsParam : "profile";
  const [creating, setCreating] = useState(false);
  const [initialMemberIds, setInitialMemberIds] = useState<string[]>([]);

  const list = spaces.data ?? [];
  const spaceId = list.some((s) => s.id === spaceParam) ? spaceParam : (list[0]?.id ?? null);
  const spaceQuery = useSpace(spaceId);
  const space = spaceId && spaceQuery.data?.id === spaceId ? spaceQuery.data : null;
  const tab: SpaceTab = SPACE_TABS.some((t) => t.id === tabParam) ? (tabParam as SpaceTab) : "expenses";
  // Recurring spaces default to this month; one-time spaces always look at everything.
  const month = space?.kind !== "recurring" ? null : monthParam === "all" ? null : monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth();
  const mainView = creating ? "new" : view === "account" ? "account" : view === "people" ? "people" : view === "docs" ? "docs" : spaces.data && !list.length ? "new" : "space";

  const error = me.error ?? spaces.error;
  const select = (id: string) => {
    setCreating(false);
    setParams({ v: null, s: id, t: null, m: null });
  };

  return (
    <div className="shell">
      <Sidebar
        me={me.data}
        spaces={list}
        selected={spaceId}
        view={mainView}
        onSpace={select}
        onNewSpace={() => { setInitialMemberIds([]); setParams({ v: null }); setCreating(true); }}
        onDocs={() => { setCreating(false); setParams({ v: "docs", doc: null }); }}
        onPeople={() => { setCreating(false); setParams({ v: "people" }); }}
        onAccount={(tab) => { setCreating(false); setParams({ v: "account", f: tab === "profile" ? null : tab }); }}
      />
      <main className="main">
        {error && <div className="banner warn">{errorMessage(error)}</div>}
        {(me.isPending || spaces.isPending) && !error ? (
          <div className="card muted">Loading your spaces…</div>
        ) : me.data && spaces.data ? (
          mainView === "account" ? (
            <SettingsPage me={me.data} tab={settingsTab} onTab={(t) => setParams({ f: t === "profile" ? null : t })} />
          ) : mainView === "docs" ? (
            <DocsPage />
          ) : mainView === "people" ? (
            <PeopleDirectory me={me.data} onNewSpace={(ids) => { setInitialMemberIds(ids); setCreating(true); }} />
          ) : mainView === "new" ? (
            <>
              {!list.length && (
                <div className="card">
                  <h3 style={{ fontSize: 20 }}>Start your first space</h3>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    A space is where shared costs live: your flat's monthly groceries, or a one-off trip. If someone already added you to a space, it appears here as soon as you sign in with the email they used.
                  </p>
                </div>
              )}
              <NewSpaceForm key={initialMemberIds.join(",")} initialMemberIds={initialMemberIds} me={me.data} onCancel={list.length || view === "people" ? () => setCreating(false) : undefined} onDone={(s) => select(s.id)} />
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
          )
        ) : null}
      </main>
    </div>
  );
}
