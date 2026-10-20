import { useState, type FormEvent } from "react";
import type { Member, PeopleInput, PersonInvite, SpaceDetail } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { setSpaceDetail, useSelectablePeople, useSpaceMutation } from "../lib/queries";
import { setParams } from "../lib/url-state";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";
import { Modal, useModalForm } from "./Modal";
import { PeoplePicker } from "./PeoplePicker";
import { peopleInput } from "../lib/people";
import { Chip } from "./People";

export function Members({ space, meId, onLeft }: { space: SpaceDetail; meId: string; onLeft(): void }) {
  const toast = useToast();
  const owner = space.myRole === "owner";
  const [adding, setAdding] = useState(false);
  // Member changes return the updated space, which goes straight into the cache.
  const setRole = useSpaceMutation(space.id, (v: { userId: string; role: "owner" | "member" }) => api.setRole(space.id, v.userId, v.role), [], setSpaceDetail);
  const remove = useSpaceMutation(space.id, (userId: string) => api.removeMember(space.id, userId), ["detail", "spaces", "groups"]);
  const merge = useSpaceMutation(space.id, (v: { userId: string; into: string }) => api.mergeMember(space.id, v.userId, v.into), ["everything"], setSpaceDetail);
  const fail = (err: unknown) => toast(errorMessage(err));

  const registered = space.members.filter((m) => m.active && m.registered);
  const active = space.members.filter((m) => m.active);
  const former = space.members.filter((m) => !m.active);

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
      <div className="sechead"><h2>Members ({active.length})</h2><div className="headbtns"><button type="button" className="btn" onClick={() => setParams({ v: null, t: "groups" })}>Groups</button>{owner && <button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add people</button>}</div></div>
      <div className="card" style={{ padding: 0 }}>
        <ul className="memberlist">{active.map(row)}{former.map(row)}</ul>
      </div>
      {owner ? (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="note">Search all registered people by name. Their email addresses stay private in the directory. People can leave or be removed only once their balance is zero.</p>
        </div>
      ) : (
        <p className="note">Only the space owner can add or remove people. You can add and edit expenses.</p>
      )}
    {adding && <Modal compact title="Add people" description={`Bring people into ${space.name}.`} onClose={() => setAdding(false)}><AddPeople space={space} onDone={() => setAdding(false)} /></Modal>}
    </section>
  );
}

function AddPeople({ space, onDone }: { space: SpaceDetail; onDone(): void }) {
  const toast = useToast();
  const people = useSelectablePeople();
  const [ids, setIds] = useState<string[]>([]);
  const [invites, setInvites] = useState<PersonInvite[]>([]);
  const [error, setError] = useState("");
  const [invitationPending, setInvitationPending] = useState(false);
  const add = useSpaceMutation(space.id, (input: PeopleInput) => api.addMembers(space.id, input), ["spaces", "people"], setSpaceDetail);
  const cancel = useModalForm(invitationPending || ids.length > 0 || invites.length > 0, add.isPending, onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault(); if (add.isPending || people.isPending || people.error) return;
    if (invitationPending) return setError("Add or cancel the pending invitation first.");
    if (!ids.length && !invites.length) return setError("Choose at least one person.");
    setError("");
    add.mutate(peopleInput(ids, people.data, invites), { onSuccess: () => { toast("People added"); onDone(); }, onError: (err) => setError(errorMessage(err)) });
  };
  return <form onSubmit={submit} noValidate>
    <div className="editor-content"><PeoplePicker onPendingChange={setInvitationPending} legend="People to add" ids={ids} onIds={setIds} invites={invites} onInvites={setInvites} exclude={space.members.filter((m) => m.active).map((m) => m.id)} disabled={add.isPending} />{error && <p className="err" role="alert">{error}</p>}</div>
    <footer className="editor-footer"><span>{ids.length + invites.length} selected</span><div className="editor-actions"><button type="button" className="btn" disabled={add.isPending} onClick={cancel}>Cancel</button><button type="submit" className="btn primary" disabled={add.isPending || people.isPending || !!people.error || invitationPending}>{add.isPending ? "Adding…" : "Add people"}</button></div></footer>
  </form>;
}
