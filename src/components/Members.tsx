import { useState, type FormEvent } from "react";
import type { Member, SpaceDetail } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { setSpaceDetail, useGroups, usePeople, useSpaceMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";
import { isEmail } from "./emails";
import { Chip } from "./People";

export function Members({ space, meId, onLeft }: { space: SpaceDetail; meId: string; onLeft(): void }) {
  const toast = useToast();
  const owner = space.myRole === "owner";
  const groups = useGroups();
  const people = usePeople();
  const [pick, setPick] = useState("");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  // Member changes return the updated space, which goes straight into the cache.
  const add = useSpaceMutation(space.id, (who: { userId: string } | { email: string }) => api.addMember(space.id, who), ["spaces", "people"], setSpaceDetail);
  const addGroup = useSpaceMutation(space.id, (groupId: string) => api.addGroupToSpace(space.id, groupId), ["spaces", "people"], setSpaceDetail);
  const setRole = useSpaceMutation(space.id, (v: { userId: string; role: "owner" | "member" }) => api.setRole(space.id, v.userId, v.role), [], setSpaceDetail);
  const remove = useSpaceMutation(space.id, (userId: string) => api.removeMember(space.id, userId), ["detail", "spaces"]);
  const merge = useSpaceMutation(space.id, (v: { userId: string; into: string }) => api.mergeMember(space.id, v.userId, v.into), ["everything"], setSpaceDetail);
  const fail = (err: unknown) => toast(errorMessage(err));

  const registered = space.members.filter((m) => m.active && m.registered);
  const active = space.members.filter((m) => m.active);
  const former = space.members.filter((m) => !m.active);

  const inSpace = new Set(active.map((m) => m.id));
  const candidates = (people.data ?? []).filter((p) => !inSpace.has(p.id));

  const addPerson = (e: FormEvent) => {
    e.preventDefault();
    if (!pick) return setError("Choose someone to add.");
    setError("");
    const name = candidates.find((p) => p.id === pick)?.name ?? "them";
    add.mutate({ userId: pick }, {
      onSuccess: () => { setPick(""); toast(`Added ${name}`); },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!isEmail(em)) return setError("Enter their email address.");
    setError("");
    add.mutate({ email: em }, {
      onSuccess: () => { setEmail(""); setInviting(false); toast("Invited. They join by signing in with that email."); },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  const row = (m: Member) => (
    <li key={m.id} className={`memberrow${m.active ? "" : " left"}`}>
      <Chip id={m.id} />
      <span className="grow">
        <span>
          <strong>{m.name}</strong>
          {m.id === meId && <span className="tag">you</span>}
          {m.role === "owner" && m.active && <span className="tag accent">owner</span>}
          {!m.registered && <span className="tag">{m.email ? "invited" : "not linked"}</span>}
          {!m.active && <span className="tag">left</span>}
        </span>
        <span className="muted" style={{ fontSize: 13 }}>{m.email ?? "Imported name with no account yet"}</span>
      </span>
      {m.active && !m.registered && (
        <>
          <button type="button" className="btn small" disabled={merge.isPending} onClick={() => merge.mutate({ userId: m.id, into: meId }, { onSuccess: () => toast(`${m.name} is now you`), onError: fail })}>
            This is me
          </button>
          {owner && registered.length > 1 && (
            <select aria-label={`Link ${m.name} to an account`} value="" onChange={(e) => e.target.value && merge.mutate({ userId: m.id, into: e.target.value }, { onSuccess: () => toast("Linked"), onError: fail })}>
              <option value="">Link to…</option>
              {registered.filter((r) => r.id !== meId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
        </>
      )}
      {m.active && owner && m.id !== meId && m.registered && (
        <button type="button" className="btn small" disabled={setRole.isPending} onClick={() => setRole.mutate({ userId: m.id, role: m.role === "owner" ? "member" : "owner" }, { onError: fail })}>
          {m.role === "owner" ? "Make member" : "Make owner"}
        </button>
      )}
      {m.active && (m.id === meId || owner) && (
        <ConfirmButton
          confirmLabel={m.id === meId ? "Confirm leave" : "Confirm remove"}
          disabled={remove.isPending}
          onConfirm={() => remove.mutate(m.id, { onSuccess: () => { toast(m.id === meId ? "You left the space" : "Removed"); if (m.id === meId) onLeft(); }, onError: fail })}
        >
          {m.id === meId ? "Leave" : "Remove"}
        </ConfirmButton>
      )}
    </li>
  );

  return (
    <section className="sec">
      <div className="sechead"><h2>Members ({active.length})</h2></div>
      <div className="card" style={{ padding: 0 }}>
        <ul className="memberlist">{active.map(row)}{former.map(row)}</ul>
      </div>
      {owner ? (
        <div className="card" style={{ marginTop: 12 }}>
          <form className="inline" onSubmit={addPerson} noValidate>
            <div className="field">
              <label htmlFor="m-person">Add someone you know</label>
              <select id="m-person" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!candidates.length}>
                <option value="">{people.isPending ? "Loading…" : candidates.length ? "Choose a person" : "Everyone you know is already here"}</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.email ? ` · ${p.email}` : ""}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn primary" disabled={add.isPending || !pick}>Add</button>
          </form>
          {inviting ? (
            <form className="inline" onSubmit={invite} noValidate style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="m-email">Invite someone new by email</label>
                <input id="m-email" type="email" placeholder="friend@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </div>
              <button type="submit" className="btn" disabled={add.isPending}>Invite</button>
              <button type="button" className="btn" onClick={() => { setInviting(false); setError(""); }}>Cancel</button>
            </form>
          ) : (
            <p className="note" style={{ marginTop: 10 }}>
              Not in the list? <button type="button" className="linkbtn" onClick={() => setInviting(true)}>Invite someone new by email</button>
            </p>
          )}
          <div className="err" role="alert" style={{ marginTop: 8 }}>{error}</div>
          {!!groups.data?.length && (
            <div className="groupbtns" style={{ marginTop: 12 }}>
              <span className="lbl">Add everyone from a group</span>
              {groups.data.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="btn small"
                  disabled={addGroup.isPending}
                  title={g.members.map((p) => p.name).join(", ")}
                  onClick={() => addGroup.mutate(g.id, { onSuccess: () => toast(`Added ${g.name}`), onError: fail })}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          <p className="note">The list shows everyone you share a space or group with. People can leave or be removed only once their balance is zero.</p>
        </div>
      ) : (
        <p className="note">Only the space owner can add or remove people. You can add and edit expenses.</p>
      )}
    </section>
  );
}
