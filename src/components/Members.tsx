import { useState, type FormEvent } from "react";
import type { GroupDetail, Member } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useGroupMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";
import { Chip } from "./People";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Members({ group, meId, onLeft }: { group: GroupDetail; meId: string; onLeft(): void }) {
  const toast = useToast();
  const owner = group.myRole === "owner";
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const add = useGroupMutation(group.id, (v: { email: string }) => api.addMember(group.id, v.email));
  const setRole = useGroupMutation(group.id, (v: { userId: string; role: "owner" | "member" }) => api.setRole(group.id, v.userId, v.role));
  const remove = useGroupMutation(group.id, (userId: string) => api.removeMember(group.id, userId));
  const merge = useGroupMutation(group.id, (v: { userId: string; into: string }) => api.mergeMember(group.id, v.userId, v.into));
  const fail = (err: unknown) => toast(errorMessage(err));

  const registered = group.members.filter((m) => m.active && m.registered);
  const active = group.members.filter((m) => m.active);
  const former = group.members.filter((m) => !m.active);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) return setError("Enter their email address.");
    setError("");
    add.mutate({ email: em }, {
      onSuccess: () => { setEmail(""); toast("Added. They join by signing in with that email."); },
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
          onConfirm={() => remove.mutate(m.id, { onSuccess: () => { toast(m.id === meId ? "You left the group" : "Removed"); if (m.id === meId) onLeft(); }, onError: fail })}
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
      <form className="card" onSubmit={submit} noValidate style={{ marginTop: 12 }}>
        <div className="inline">
          <div className="field">
            <label htmlFor="m-email">Add someone by email</label>
            <input id="m-email" type="email" placeholder="friend@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="submit" className="btn primary" disabled={add.isPending}>Add</button>
        </div>
        <div className="err" role="alert" style={{ marginTop: 8 }}>{error}</div>
        <p className="note">No email is sent. Share this site with them; they appear here as soon as they sign in with that address. People can leave or be removed only once their balance is zero.</p>
      </form>
    </section>
  );
}
