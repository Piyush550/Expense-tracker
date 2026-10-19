import { useState, type FormEvent } from "react";
import type { GroupDetail } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useGroupMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";

export function GroupSettings({ group, onDeleted }: { group: GroupDetail; onDeleted(): void }) {
  const toast = useToast();
  const [name, setName] = useState(group.name);
  const update = useGroupMutation(group.id, (patch: { name?: string; simplifyDebts?: boolean }) => api.updateGroup(group.id, patch));
  const remove = useGroupMutation(group.id, () => api.deleteGroup(group.id));

  const rename = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || n === group.name) return;
    update.mutate({ name: n }, { onSuccess: () => toast("Group renamed"), onError: (err) => toast(errorMessage(err)) });
  };

  return (
    <section className="sec">
      <div className="sechead"><h2>Group settings</h2></div>
      <div className="card">
        <form className="inline" onSubmit={rename} noValidate>
          <div className="field">
            <label htmlFor="gs-name">Group name</label>
            <input id="gs-name" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button type="submit" className="btn" disabled={update.isPending || !name.trim() || name.trim() === group.name}>Rename</button>
        </form>
        <label className="check" style={{ marginTop: 16 }}>
          <input
            type="checkbox"
            checked={group.simplifyDebts}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ simplifyDebts: e.target.checked }, { onError: (err) => toast(errorMessage(err)) })}
          />
          Simplify debts
        </label>
        <p className="note" style={{ marginTop: 4 }}>
          On: the fewest payments overall, even between people who never shared an expense. Off: everyone pays back exactly who they owe.
        </p>
        {group.myRole === "owner" && (
          <div className="formfoot">
            <ConfirmButton
              className="btn danger"
              confirmLabel="Confirm: delete group and all its expenses"
              disabled={remove.isPending}
              onConfirm={() => remove.mutate(undefined, { onSuccess: () => { toast("Group deleted"); onDeleted(); }, onError: (err) => toast(errorMessage(err)) })}
            >
              Delete group
            </ConfirmButton>
            <span className="grow">Only possible once everyone is settled up.</span>
          </div>
        )}
      </div>
    </section>
  );
}
