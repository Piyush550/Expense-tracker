import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { Me } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { keys } from "../lib/queries";
import { useToast } from "../lib/toast";

export function Account({ me }: { me: Me }) {
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(me.name);
  const save = useMutation({
    mutationFn: (n: string) => api.updateMe(n),
    onSuccess: (updated) => {
      qc.setQueryData(keys.me, updated);
      void qc.invalidateQueries({ queryKey: ["space"] });
      void qc.invalidateQueries({ queryKey: keys.groups });
      auth.setDisplayName(updated.name).catch(() => {}); // the API copy is what others see
      setOpen(false);
      toast("Name updated");
    },
    onError: (err) => toast(errorMessage(err)),
  });

  if (open) {
    return (
      <form className="card" onSubmit={(e: FormEvent) => { e.preventDefault(); if (name.trim()) save.mutate(name.trim()); }} noValidate>
        <div className="sechead"><h2>Your name</h2></div>
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="n-name">Shown to everyone in your groups</label>
          <input id="n-name" type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
        </div>
        <div className="formfoot">
          <button type="submit" className="btn primary" disabled={save.isPending}>Save name</button>
          <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </form>
    );
  }
  return (
    <div className="acct">
      <span className="muted">Signed in as</span>
      <strong>{me.name}</strong>
      <span className="muted">{me.email}</span>
      <span className="acct-links">
        <button type="button" className="linkbtn" onClick={() => { setName(me.name); setOpen(true); }}>Change my name</button>
        <button type="button" className="linkbtn" onClick={() => auth.signOut()}>Sign out</button>
      </span>
    </div>
  );
}
