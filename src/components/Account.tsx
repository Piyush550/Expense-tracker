import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { Me } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { keys } from "../lib/queries";
import { useToast } from "../lib/toast";

export function Account({ me, onDone }: { me: Me; onDone?: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(me.name);
  const save = useMutation({
    mutationFn: (n: string) => api.updateMe(n),
    onSuccess: (updated) => {
      qc.setQueryData(keys.me, updated);
      void qc.invalidateQueries({ queryKey: ["space"] });
      void qc.invalidateQueries({ queryKey: keys.groups });
      auth.setDisplayName(updated.name).catch(() => {}); // the API copy is what others see
      toast("Name updated");
      onDone?.();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  return (
    <form className="card" onSubmit={(e: FormEvent) => { e.preventDefault(); if (name.trim()) save.mutate(name.trim()); }} noValidate style={{ maxWidth: 480 }}>
      <div className="sechead"><h2>Your name</h2></div>
      <div className="field">
        <label htmlFor="n-name">Shown to everyone in your spaces</label>
        <input id="n-name" type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
      </div>
      <p className="note">Signed in as {me.email}.</p>
      <div className="formfoot">
        <button type="submit" className="btn primary" disabled={save.isPending || !name.trim() || name.trim() === me.name}>Save name</button>
        {onDone && <button type="button" className="btn" onClick={onDone}>Back</button>}
      </div>
    </form>
  );
}
