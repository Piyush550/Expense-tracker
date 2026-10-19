import { useState, type FormEvent } from "react";
import type { Group } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useGroups, useSpaceMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";
import { PeoplePicker } from "./PeoplePicker";

function GroupForm({ group, meId, onDone }: { group: Group | null; meId: string; onDone(): void }) {
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? "");
  const [ids, setIds] = useState<string[]>(group ? group.members.map((m) => m.id).filter((id) => id !== meId) : []);
  const [emails, setEmails] = useState<string[]>([]);
  const [error, setError] = useState("");
  const save = useSpaceMutation(
    null,
    (v: { name: string }) =>
      group ? api.updateGroup(group.id, { name: v.name, memberIds: ids, memberEmails: emails }) : api.createGroup(v.name, ids, emails),
    ["groups", "people"],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError("Give the group a name.");
    setError("");
    save.mutate({ name: n }, {
      onSuccess: () => { toast(group ? "Group saved" : "Group created"); onDone(); },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <form className="card formcard" onSubmit={submit} noValidate>
      <div className="sechead"><h2>{group ? "Edit group" : "New group"}</h2></div>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="gr-name">Group name</label>
        <input id="gr-name" type="text" maxLength={60} placeholder="Boys Flat, Office lunch…" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div style={{ marginTop: 14 }}>
        <PeoplePicker legend="People in it (you are always included)" ids={ids} onIds={setIds} emails={emails} onEmails={setEmails} />
      </div>
      <div className="formfoot">
        <button type="submit" className="btn primary" disabled={save.isPending}>{group ? "Save group" : "Create group"}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <span className="err" role="alert">{error}</span>
      </div>
    </form>
  );
}

export function GroupsPage({ meId }: { meId: string }) {
  const toast = useToast();
  const groups = useGroups();
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const remove = useSpaceMutation(null, (id: string) => api.deleteGroup(id), ["groups", "people"]);

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Groups</h2>
        {!editing && <button type="button" className="btn primary" onClick={() => setEditing("new")}>+ New group</button>}
      </div>
      <p className="note" style={{ margin: "0 0 12px" }}>
        A group is a saved list of people, like "Boys Flat". Use it in any space: add all its people to a space in one go,
        or pick them in one click when adding an expense. Everyone in a group can use it; only the person who made it can change it.
      </p>
      {editing && <GroupForm key={editing === "new" ? "new" : editing.id} group={editing === "new" ? null : editing} meId={meId} onDone={() => setEditing(null)} />}
      {groups.isPending ? (
        <div className="card muted">Loading…</div>
      ) : groups.error ? (
        <div className="banner warn">{errorMessage(groups.error)}</div>
      ) : !groups.data?.length ? (
        !editing && <div className="card empty">No groups yet.</div>
      ) : (
        <div className="card" style={{ padding: 0, marginTop: editing ? 12 : 0 }}>
          <ul className="grouplist">
            {groups.data.map((g) => (
              <li key={g.id} className="grouprow">
                <strong>{g.name}</strong>
                <div className="x-with">
                  {g.members.map((m) => (
                    <span key={m.id} className="personpill" title={m.email ?? undefined}>
                      {m.name}{!m.registered && <span className="tag">invited</span>}
                    </span>
                  ))}
                </div>
                <div className="x-act">
                  {g.canEdit ? (
                    <>
                      <button type="button" className="btn small" onClick={() => setEditing(g)}>Edit</button>
                      <ConfirmButton
                        confirmLabel="Confirm delete"
                        disabled={remove.isPending}
                        onConfirm={() => remove.mutate(g.id, { onSuccess: () => toast("Group deleted"), onError: (err) => toast(errorMessage(err)) })}
                      >
                        Delete
                      </ConfirmButton>
                    </>
                  ) : (
                    <span className="muted" style={{ fontSize: 13 }}>shared with you</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
