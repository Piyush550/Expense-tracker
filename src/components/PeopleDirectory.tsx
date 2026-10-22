import { useEffect, useId, useState } from "react";
import type { DirectoryPerson, Me } from "../../shared/api";
import { errorMessage } from "../lib/api";
import { useDirectoryPage } from "../lib/queries";
import { hueFor } from "./People";

/** A bounded, name-only directory. Selection survives search and page changes. */
export function PeopleDirectory({ me, onNewSpace }: { me: Me; onNewSpace(ids: string[]): void }) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState({ search: "", limit: 20, offset: 0 });
  const [selected, setSelected] = useState<DirectoryPerson[]>([]);
  const query = useDirectoryPage(page.search, page.limit, page.offset);
  const data = query.data;
  const typing = search.trim() !== page.search;
  useEffect(() => {
    const timer = setTimeout(() => setPage((current) => current.search === search.trim() ? current : { ...current, search: search.trim(), offset: 0 }), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    // Someone may disappear between cached visits; move to the last valid page after refresh.
    if (data && data.offset > 0 && data.offset >= data.total) {
      setPage((current) => ({ ...current, offset: Math.max(0, Math.floor((data.total - 1) / current.limit) * current.limit) }));
    }
  }, [data]);
  const busy = query.isFetching || typing;
  const toggle = (person: DirectoryPerson) => setSelected((current) => current.some((p) => p.id === person.id)
    ? current.filter((p) => p.id !== person.id) : current.length < 50 ? [...current, person] : current);
  const start = data?.people.length ? page.offset + 1 : 0;
  const end = data ? page.offset + data.people.length : 0;
  const total = data?.total ?? 0;
  return <section className="directory" aria-labelledby="directory-title">
    <div className="spacehead">
      <div><h1 id="directory-title" className="spacetitle">People</h1><p className="sub">Find people on Expense Tracker and start a space together.</p></div>
      <button type="button" className="btn primary" onClick={() => onNewSpace(selected.map((p) => p.id))}>
        + New space{selected.length ? ` with ${selected.length} ${selected.length === 1 ? "person" : "people"}` : ""}
      </button>
    </div>
    <div className="directory-card">
      <div className="directory-tools">
        <div className="directory-search"><label htmlFor={searchId}>Search people</label><input id={searchId} type="search" autoComplete="off" maxLength={100} placeholder="Search by name…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <button type="button" className="btn" disabled={busy} onClick={() => void query.refetch()}>{query.isFetching ? "Refreshing…" : "Refresh"}</button>
      </div>
      <div className="directory-summary"><span aria-live="polite">{query.isPending || typing ? "Finding people…" : `${total} ${total === 1 ? "person" : "people"}${page.search ? " found" : " on the platform"}`}</span><span>Names only · emails stay private</span></div>
      {selected.length > 0 && <div className="directory-selection"><div><strong>{selected.length} selected</strong><span>{selected.map((p) => p.name).join(", ")}</span></div><button type="button" className="linkbtn" onClick={() => setSelected([])}>Clear selection</button></div>}
      {selected.length >= 50 && <p className="directory-limit" role="status">You can add up to 50 people at a time.</p>}
      {query.error ? <div className="directory-empty" role="alert"><strong>Couldn’t load people</strong><p>{errorMessage(query.error)}</p><button type="button" className="btn" onClick={() => void query.refetch()}>Try again</button></div>
        : query.isPending || typing ? <div className="directory-empty" role="status">Loading people…</div>
        : !data?.people.length ? <div className="directory-empty" role="status"><strong>{page.search ? "No matching people" : "No people on this page"}</strong><p>{page.search ? "Try another name. Only people who have signed in are listed." : "Refresh to check for people who recently joined."}</p>{page.search && <button type="button" className="btn" onClick={() => setSearch("")}>Clear search</button>}</div>
        : <ul className="directory-list" aria-label="Registered people" aria-busy={query.isFetching}>
          {data.people.map((person) => {
            const you = person.id === me.id;
            const checked = selected.some((p) => p.id === person.id);
            const initials = person.name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
            return <li key={person.id}><label className={`directory-person${checked ? " selected" : ""}${you ? " yourself" : ""}`}>
              <input type="checkbox" aria-label={you ? `${person.name}, you are included automatically` : `Select ${person.name}`} checked={you || checked} disabled={you || (!checked && selected.length >= 50)} onChange={() => toggle(person)} />
              <span className="directory-avatar" style={{ ["--h" as string]: hueFor(person.id) }} aria-hidden="true">{initials}</span>
              <span className="directory-name"><strong>{person.name}</strong>{you && <small>Included in every space you create</small>}</span>
              <span className="directory-badge">{you ? "You" : "Registered"}</span>
            </label></li>;
          })}
        </ul>}
      <div className="directory-pagination">
        <div className="directory-page-size"><label htmlFor={`${searchId}-size`}>Per page</label><select id={`${searchId}-size`} value={page.limit} onChange={(event) => setPage((current) => ({ ...current, limit: Number(event.target.value), offset: 0 }))}>{[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></div>
        <span aria-live="polite">{query.isPending || typing ? "…" : `${start}–${end} of ${total}`}</span>
        <nav aria-label="People pages"><button type="button" className="btn small" disabled={busy || page.offset === 0} onClick={() => setPage((current) => ({ ...current, offset: Math.max(0, current.offset - current.limit) }))}>Previous</button><button type="button" className="btn small" disabled={busy || !data || end >= total} onClick={() => setPage((current) => ({ ...current, offset: current.offset + current.limit }))}>Next</button></nav>
      </div>
    </div>
    <p className="note">Choose people across pages, then create a space. You’ll be its owner and can set up groups and quick actions during onboarding.</p>
  </section>;
}
