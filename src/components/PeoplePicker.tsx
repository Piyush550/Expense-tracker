import { useMemo, useState } from "react";
import type { Person } from "../../shared/api";
import { usePeople } from "../lib/queries";
import { isEmail } from "./emails";

/**
 * Pick people you already know (from your spaces and groups) by name, and invite anyone new
 * by email. `exclude` hides people who are already in.
 */
export function PeoplePicker({ ids, onIds, emails, onEmails, exclude = [], legend }: {
  ids: string[];
  onIds(ids: string[]): void;
  emails: string[];
  onEmails(emails: string[]): void;
  exclude?: string[];
  legend: string;
}) {
  const people = usePeople();
  const [filter, setFilter] = useState("");
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState("");
  const list = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (people.data ?? []).filter(
      (p: Person) => !exclude.includes(p.id) && (!term || p.name.toLowerCase().includes(term) || (p.email ?? "").includes(term)),
    );
  }, [people.data, filter, exclude]);

  const toggle = (id: string) => onIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const addInvite = () => {
    const e = invite.trim().toLowerCase();
    if (!isEmail(e)) return setInviteError("That is not an email address.");
    const known = people.data?.find((p) => p.email === e);
    if (known) {
      if (!ids.includes(known.id)) onIds([...ids, known.id]);
    } else if (!emails.includes(e)) onEmails([...emails, e]);
    setInvite("");
    setInviteError("");
  };

  return (
    <div className="field">
      <div className="legend">{legend}</div>
      {(people.data?.length ?? 0) > 8 && (
        <input type="search" className="pickfilter" aria-label="Find a person" placeholder="Find a person" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {people.isPending ? (
        <p className="note" style={{ margin: 0 }}>Loading your people…</p>
      ) : list.length ? (
        <div className="picks" role="group" aria-label={legend}>
          {list.map((p) => (
            <label key={p.id} className="pick" title={p.email ?? undefined}>
              <input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.name}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="note" style={{ margin: 0 }}>
          {people.data?.length ? "Everyone you know is already in." : "People you share a space or group with show up here. Invite someone new below."}
        </p>
      )}
      {emails.length > 0 && (
        <div className="picks" style={{ marginTop: 8 }}>
          {emails.map((e) => (
            <span key={e} className="personpill">
              {e} <span className="tag">new</span>
              <button type="button" className="linkbtn" aria-label={`Remove ${e}`} onClick={() => onEmails(emails.filter((x) => x !== e))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="inline" style={{ marginTop: 8 }}>
        <div className="field">
          <label htmlFor="pp-invite" className="muted" style={{ fontWeight: 500 }}>Someone new? Invite by email</label>
          <input
            id="pp-invite"
            type="email"
            placeholder="friend@gmail.com"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addInvite(); } }}
          />
        </div>
        <button type="button" className="btn" onClick={addInvite}>Add</button>
      </div>
      <div className="err" role="alert">{inviteError}</div>
    </div>
  );
}
