import { useState, type FormEvent } from "react";
import type { Group } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useGroupMutation, useGroups } from "../lib/queries";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";
import { parseEmails } from "./emails";

function GroupForm({ group, meEmail, onDone }: { group: Group | null; meEmail: string; onDone(): void }) {
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? "");
  const [emails, setEmails] = useState(
    group ? group.members.map((m) => m.email).filter((e): e is string => !!e && e !== meEmail).join(", ") : "",
  );
  const [error, setError] = useState("");
  const save = useGroupMutation((v: { name: string; emails: string[] }) =>
    group ? api.updateGroup(group.id, { name: v.name, memberEmails: v.emails }) : api.createGroup(v.name, v.emails),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError("Give the group a name.");
    const parsed = parseEmails(emails);
    if (parsed.bad) return setError(`"${parsed.bad}" is not an email address.`);
    setError("");
    save.mutate({ name: n, emails: parsed.emails }, {
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
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="gr-emails">People in it (emails). You are always included.</label>
        <textarea id="gr-emails" rows={2} placeholder="ishan@gmail.com, piyush@gmail.com" value={emails} onChange={(e) => setEmails(e.target.value)} />
      </div>
      <div className="formfoot">
        <button type="submit" className="btn primary" disabled={save.isPending}>{group ? "Save group" : "Create group"}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <span className="err" role="alert">{error}</span>
      </div>
    </form>
  );
}

export function GroupsPage({ meEmail }: { meEmail: string }) {
  const toast = useToast();
  const groups = useGroups();
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const remove = useGroupMutation((id: string) => api.deleteGroup(id));

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
      {editing && <GroupForm key={editing === "new" ? "new" : editing.id} group={editing === "new" ? null : editing} meEmail={meEmail} onDone={() => setEditing(null)} />}
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
