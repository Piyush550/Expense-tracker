import { useEffect, useId, useState } from "react";
import type { Person, PersonInvite } from "../../shared/api";
import { errorMessage } from "../lib/api";
import { useSelectablePeople } from "../lib/queries";
import { PeopleSelect } from "./PeopleSelect";
import { isEmail } from "./emails";

/** Name-first directory selection, with named invitations for people who have not joined. */
export function PeoplePicker({ ids, onIds, invites, onInvites, exclude = [], legend, extraPeople = [], disabled = false, onPendingChange }: {
  ids: string[]; onIds(ids: string[]): void; invites: PersonInvite[]; onInvites(invites: PersonInvite[]): void;
  exclude?: string[]; legend: string; extraPeople?: Person[]; disabled?: boolean; onPendingChange?(pending: boolean): void;
}) {
  const people = useSelectablePeople();
  const id = useId();
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { onPendingChange?.(!!(name.trim() || email.trim())); }, [name, email, onPendingChange]);
  const map = new Map(extraPeople.map((p) => [p.id, p]));
  people.data.forEach((p) => map.set(p.id, p));
  const options = [...map.values()].filter((p) => !exclude.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const addInvite = () => {
    const n = name.trim(); const em = email.trim().toLowerCase();
    if (!n) return setError("Enter their name so everyone recognises them.");
    if (!isEmail(em)) return setError("Enter the email they will use to sign in.");
    const known = options.find((p) => p.email === em);
    if (known) { if (!ids.includes(known.id)) onIds([...ids, known.id]); }
    else if (invites.some((p) => p.email === em)) return setError("That person is already on the invitation list.");
    else onInvites([...invites, { name: n, email: em }]);
    setName(""); setEmail(""); setError(""); setInviting(false);
  };
  return <div className="people-picker">
    {people.error ? <div className="banner warn">{errorMessage(people.error)} <button type="button" className="linkbtn" onClick={() => void people.refetch()}>Try again</button></div>
      : people.isPending ? <p className="note">Loading people…</p> : null}
    <PeopleSelect people={options} ids={ids} onIds={onIds} label={legend} disabled={disabled || people.isPending || !!people.error} />
    {invites.length > 0 && <div className="invitation-list" aria-label="People to invite">
      {invites.map((p) => <div key={p.email} className="invitation-row"><span className="person-initial" aria-hidden="true">{p.name.slice(0, 2)}</span><span className="stack"><strong>{p.name}</strong><small>Will join when they sign in</small></span><span className="tag">New</span><button type="button" className="iconbtn" disabled={disabled} aria-label={`Remove invitation for ${p.name}`} onClick={() => onInvites(invites.filter((v) => v.email !== p.email))}>×</button></div>)}
    </div>}
    {inviting ? <div className="invite-panel">
      <div className="invite-panel-title"><strong>Invite someone new</strong><button type="button" className="linkbtn" onClick={() => { setInviting(false); setName(""); setEmail(""); setError(""); }}>Cancel</button></div>
      <p>Use their name and the email they will sign in with. Their account will link automatically.</p>
      <div className="invite-fields">
        <div className="field"><label htmlFor={`${id}-name`}>Their name</label><input id={`${id}-name`} type="text" maxLength={40} placeholder="e.g. Priya" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById(`${id}-email`)?.focus(); } }} autoFocus /></div>
        <div className="field"><label htmlFor={`${id}-email`}>Sign-in email</label><input id={`${id}-email`} type="email" autoCapitalize="none" spellCheck={false} placeholder="priya@gmail.com" value={email} disabled={disabled} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addInvite(); } }} /></div>
      </div>
      {error && <p className="err" role="alert">{error}</p>}<button type="button" className="btn" disabled={disabled} onClick={addInvite}>Add to invitation list</button>
      <small className="muted">Add this person to the invitation list before saving. No invitation email is sent.</small>
    </div> : <button type="button" className="invite-link" disabled={disabled} onClick={() => setInviting(true)}><span aria-hidden="true">＋</span> Someone missing? Invite by name and email</button>}
  </div>;
}
