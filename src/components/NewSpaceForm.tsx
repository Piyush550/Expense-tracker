import { useState, type FormEvent } from "react";
import type { SpaceDetail, SpaceKind } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useGroups, useSpaceMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { parseEmails } from "./emails";

export function NewSpaceForm({ onDone, onCancel }: { onDone(space: SpaceDetail): void; onCancel?: () => void }) {
  const toast = useToast();
  const groups = useGroups();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SpaceKind>("recurring");
  const [emails, setEmails] = useState("");
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const create = useSpaceMutation(null, api.createSpace);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError("Give the space a name.");
    const parsed = parseEmails(emails);
    if (parsed.bad) return setError(`"${parsed.bad}" is not an email address.`);
    setError("");
    create.mutate({ name: n, kind, memberEmails: parsed.emails, groupIds: [...groupIds] }, {
      onSuccess: (s) => { toast("Space created"); onDone(s); },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <form className="card formcard" onSubmit={submit} noValidate>
      <div className="sechead"><h2>New space</h2></div>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="s-name">Space name</label>
        <input id="s-name" type="text" maxLength={60} placeholder="Flat groceries, Goa trip…" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <div className="legend">Kind</div>
        <div className="kindpick" role="radiogroup" aria-label="Kind of space">
          <label className={`kindopt${kind === "recurring" ? " on" : ""}`}>
            <input type="radio" name="kind" checked={kind === "recurring"} onChange={() => setKind("recurring")} />
            <strong>Recurring</strong>
            <span className="muted">Same people every month, settled month by month. Like flat groceries.</span>
          </label>
          <label className={`kindopt${kind === "one_time" ? " on" : ""}`}>
            <input type="radio" name="kind" checked={kind === "one_time"} onChange={() => setKind("one_time")} />
            <strong>One-time</strong>
            <span className="muted">Settled once at the end. Like a trip or a party.</span>
          </label>
        </div>
      </div>
      {!!groups.data?.length && (
        <div className="field" style={{ marginTop: 14 }}>
          <div className="legend">Add everyone from a group</div>
          <div className="picks">
            {groups.data.map((g) => (
              <label key={g.id} className="pick" title={g.members.map((m) => m.name).join(", ")}>
                <input
                  type="checkbox"
                  checked={groupIds.has(g.id)}
                  onChange={() => setGroupIds((prev) => { const next = new Set(prev); if (next.has(g.id)) next.delete(g.id); else next.add(g.id); return next; })}
                />
                <span>{g.name} <span className="muted">({g.members.length})</span></span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="s-emails">Add people by email (optional)</label>
        <textarea id="s-emails" rows={2} placeholder="asha@gmail.com, bala@gmail.com" value={emails} onChange={(e) => setEmails(e.target.value)} />
      </div>
      <p className="note">You will be the owner: you decide who is in the space. Everyone in it can see and add expenses. No invite email is sent; people appear once they sign in with that email.</p>
      <div className="formfoot">
        <button type="submit" className="btn primary" disabled={create.isPending}>Create space</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <span className="err" role="alert">{error}</span>
      </div>
    </form>
  );
}
