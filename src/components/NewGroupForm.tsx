import { useState, type FormEvent } from "react";
import type { GroupDetail } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useGroupMutation } from "../lib/queries";
import { useToast } from "../lib/toast";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewGroupForm({ onDone, onCancel }: { onDone(group: GroupDetail): void; onCancel?: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [error, setError] = useState("");
  const create = useGroupMutation(null, (v: { name: string; emails: string[] }) => api.createGroup(v.name, v.emails));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const list = emails.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!n) return setError("Give the group a name.");
    const bad = list.find((x) => !EMAIL_RE.test(x));
    if (bad) return setError(`"${bad}" is not an email address.`);
    setError("");
    create.mutate({ name: n, emails: list }, {
      onSuccess: (g) => {
        toast("Group created");
        onDone(g);
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <form className="card formcard" onSubmit={submit} noValidate>
      <div className="sechead"><h2>New group</h2></div>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="g-name">Group name</label>
        <input id="g-name" type="text" maxLength={60} placeholder="Flat 4B, Goa trip, Office lunch…" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="g-emails">People to add (emails, optional)</label>
        <textarea id="g-emails" rows={2} placeholder="asha@gmail.com, bala@gmail.com" value={emails} onChange={(e) => setEmails(e.target.value)} />
      </div>
      <p className="note">They join by signing in to this site with that email. No invite email is sent, so share the link with them.</p>
      <div className="formfoot">
        <button type="submit" className="btn primary" disabled={create.isPending}>Create group</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <span className="err" role="alert">{error}</span>
      </div>
    </form>
  );
}
