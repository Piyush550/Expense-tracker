import { useState, type FormEvent } from "react";
import type { Group, SpaceDetail } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useGroups, useSpaceMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { setParams } from "../lib/url-state";
import { Modal, useModalForm } from "./Modal";
import { PeopleSelect } from "./PeopleSelect";

function GroupIcon() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a4 4 0 0 1 3 4v1" /></svg>;
}

function GroupForm({ group, space, onDone }: { group: Group | null; space: SpaceDetail; onDone(): void }) {
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? "");
  const [ids, setIds] = useState<string[]>(group?.members.map((m) => m.id) ?? []);
  const [error, setError] = useState("");
  const save = useSpaceMutation(space.id, (n: string) => group
    ? api.updateGroup(space.id, group.id, { name: n, memberIds: ids })
    : api.createGroup(space.id, n, ids), ["groups"]);
  const dirty = name !== (group?.name ?? "") || JSON.stringify([...ids].sort()) !== JSON.stringify((group?.members.map((p) => p.id) ?? []).sort());
  const cancel = useModalForm(dirty, save.isPending, onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault(); if (save.isPending) return;
    if (!name.trim()) return setError("Give the group a name.");
    if (!ids.length) return setError("Choose at least one person from this space.");
    setError(""); save.mutate(name.trim(), { onSuccess: () => { toast(group ? "Group saved" : "Group created"); onDone(); }, onError: (err) => setError(errorMessage(err)) });
  };
  if (space.myRole !== "owner") return <div className="group-editor"><div className="editor-content"><p className="editor-note">Everyone in {space.name} can use this group. Space owners manage its people.</p><div className="group-detail-people">{group?.members.map((p) => <div className="person-detail" key={p.id}><span className="person-initial" aria-hidden="true">{p.name.slice(0, 2)}</span><strong>{p.name}</strong></div>)}</div></div><footer className="editor-footer"><span>{group?.members.length ?? 0} people</span><button type="button" className="btn" onClick={onDone}>Close</button></footer></div>;
  return <form className="group-editor" onSubmit={submit} noValidate><div className="editor-content">
    <div className="field"><label htmlFor="gr-name">Group name</label><input id="gr-name" type="text" maxLength={60} placeholder="e.g. Flatmates, Weekend crew, Office lunch" value={name} disabled={save.isPending} onChange={(e) => setName(e.target.value)} autoFocus /></div>
    <PeopleSelect people={space.members.filter((m) => m.active)} ids={ids} onIds={setIds} label="People in this group" disabled={save.isPending} />
    <p className="note">Select any members of this space. Add new people in Members first.</p>{error && <p className="err" role="alert">{error}</p>}
  </div><footer className="editor-footer"><span>{ids.length} {ids.length === 1 ? "person" : "people"} selected</span><div className="editor-actions"><button type="button" className="btn" disabled={save.isPending} onClick={cancel}>Cancel</button><button type="submit" className="btn primary" disabled={save.isPending}>{save.isPending ? "Saving…" : group ? "Save group" : "Create group"}</button></div></footer></form>;
}

export function GroupsPage({ space, meId }: { space: SpaceDetail; meId: string }) {
  const toast = useToast();
  const owner = space.myRole === "owner";
  const groups = useGroups(space.id);
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const remove = useSpaceMutation(space.id, (id: string) => api.deleteGroup(space.id, id), ["groups", "quickActions"]);
  const list = groups.data ?? [];
  const visible = list.filter((g) => (filter === "all" || g.members.some((p) => p.id === meId)) && `${g.name} ${g.members.map((p) => p.name).join(" ")}`.toLowerCase().includes(search.toLowerCase().trim()));
  const count = new Set(list.flatMap((g) => g.members.map((p) => p.id))).size;
  return <section className="groups-page">
    <header className="page-heading"><div><span className="eyebrow">{space.name}</span><h2>Groups</h2><p>Save combinations of people in this space and pick them whenever you split.</p></div><div className="headbtns"><button type="button" className="btn" onClick={() => setParams({ v: null, t: "quick-actions" })}>Quick actions</button>{owner && <button type="button" className="btn primary" onClick={() => setEditing("new")}>＋ Create group</button>}</div></header>
    <div className="groups-overview"><span><strong>{list.length}</strong> {list.length === 1 ? "group" : "groups"}</span><span><strong>{count}</strong> people included</span><span>Only in <strong>{space.name}</strong></span></div>
    <div className="groups-layout"><div className="groups-main">
      <div className="groups-toolbar"><input type="search" aria-label="Search groups" placeholder="Find a group or a person…" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="group-filters" role="group" aria-label="Filter groups">{[{ id: "all", label: "All groups" }, { id: "mine", label: "Including you" }].map((f) => <button type="button" key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}</div></div>
      {groups.isPending ? <div className="card empty">Loading groups…</div> : groups.error ? <div className="banner warn">{errorMessage(groups.error)} <button type="button" className="linkbtn" onClick={() => void groups.refetch()}>Try again</button></div> : visible.length ? <ul className="group-grid">{visible.map((g) => <li key={g.id} className="group-card">
        <div className="group-card-top"><span className="group-icon"><GroupIcon /></span><span className="group-permission">{space.name}</span></div>
        <h2>{g.name}</h2><p>{g.members.length} {g.members.length === 1 ? "person" : "people"} · ready for your next split</p>
        <div className="group-member-names">{g.members.slice(0, 6).map((p) => <span key={p.id}><span className="person-initial" aria-hidden="true">{p.name.slice(0, 2)}</span>{p.name}{p.id === meId ? " (you)" : ""}</span>)}{g.members.length > 6 && <span className="muted">+{g.members.length - 6} more</span>}</div>
        <footer><button type="button" className="btn" onClick={() => setEditing(g)}>{owner ? "Edit group" : "View people"}<span aria-hidden="true">↗</span></button>{owner && <button type="button" className="iconbtn" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg></button>}</footer>
      </li>)}</ul> : <div className="groups-empty"><span className="group-icon"><GroupIcon /></span><h2>{list.length ? "No groups match" : "Your next split starts here"}</h2><p>{list.length ? "Try another name or clear the filter." : owner ? "Create a group from this space’s people. Your newest three appear as expense shortcuts automatically." : "A space owner can create groups for everyone to use."}</p>{(list.length > 0 || owner) && <button type="button" className="btn primary" onClick={() => { if (list.length) { setFilter("all"); setSearch(""); } else setEditing("new"); }}>{list.length ? "Clear filters" : "Create your first group"}</button>}</div>}
    </div><aside className="groups-guide"><span className="eyebrow">Made for this space</span><h2>Same people.<br />One easy pick.</h2><p>Groups and shortcuts belong to {space.name}. Everyone here can use them; owners configure them.</p><ol><li><strong>Choose space members</strong><span>Make groups from people already here.</span></li><li><strong>Keep three handy</strong><span>Use the latest groups or configure Quick actions.</span></li><li><strong>Split in one click</strong><span>Saved expenses keep their original people and shares.</span></li></ol></aside></div>
    {editing && <Modal compact title={editing === "new" ? "Create a group" : owner ? "Edit group" : editing.name} description={`A group in ${space.name}.`} onClose={() => setEditing(null)}><GroupForm key={editing === "new" ? "new" : editing.id} group={editing === "new" ? null : editing} space={space} onDone={() => setEditing(null)} /></Modal>}
    {deleting && <Modal title="Delete this group?" description={deleting.name} onClose={() => { if (!remove.isPending) setDeleting(null); }}><div className="editor-content"><p>This group and its shortcut will be removed from {space.name}. Saved expense splits stay unchanged.</p>{remove.error && <p className="err" role="alert">{errorMessage(remove.error)}</p>}</div><footer className="editor-footer"><button type="button" className="btn" disabled={remove.isPending} onClick={() => setDeleting(null)}>Keep group</button><button type="button" className="btn danger" disabled={remove.isPending} onClick={() => remove.mutate(deleting.id, { onSuccess: () => { toast("Group deleted"); setDeleting(null); } })}>{remove.isPending ? "Deleting…" : "Delete group"}</button></footer></Modal>}
  </section>;
}
