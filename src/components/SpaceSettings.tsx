import { useState, type FormEvent } from "react";
import type { SpaceDetail, SpaceKind } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { setSpaceDetail, useSpaceMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";

export function SpaceSettings({ space, onDeleted }: { space: SpaceDetail; onDeleted(): void }) {
  const toast = useToast();
  const owner = space.myRole === "owner";
  const [name, setName] = useState(space.name);
  const update = useSpaceMutation(
    space.id,
    (patch: { name?: string; kind?: SpaceKind; simplifyDebts?: boolean }) => api.updateSpace(space.id, patch),
    ["spaces", "balances"],
    setSpaceDetail,
  );
  const remove = useSpaceMutation(space.id, () => api.deleteSpace(space.id), ["spaces"]);
  const fail = (err: unknown) => toast(errorMessage(err));

  const rename = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || n === space.name) return;
    update.mutate({ name: n }, { onSuccess: () => toast("Space renamed"), onError: fail });
  };

  return (
    <section className="sec">
      <div className="sechead"><h2>Space settings</h2></div>
      <div className="card">
        {!owner && <p className="note" style={{ marginTop: 0 }}>Only the space owner can change these.</p>}
        <form className="inline" onSubmit={rename} noValidate>
          <div className="field">
            <label htmlFor="ss-name">Space name</label>
            <input id="ss-name" type="text" maxLength={60} value={name} disabled={!owner} onChange={(e) => setName(e.target.value)} />
          </div>
          {owner && <button type="submit" className="btn" disabled={update.isPending || !name.trim() || name.trim() === space.name}>Rename</button>}
        </form>

        <div className="field" style={{ marginTop: 16 }}>
          <div className="legend">Kind</div>
          <div className="seg" role="group" aria-label="Kind of space">
            {(["recurring", "one_time"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={space.kind === k}
                disabled={!owner || update.isPending}
                onClick={() => k !== space.kind && update.mutate({ kind: k }, { onSuccess: () => toast("Kind changed"), onError: fail })}
              >
                {k === "recurring" ? "Recurring (monthly)" : "One-time"}
              </button>
            ))}
          </div>
          <p className="note" style={{ marginTop: 4 }}>Recurring spaces are settled month by month. One-time spaces are settled once, over everything.</p>
        </div>

        <label className="check" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={space.simplifyDebts}
            disabled={!owner || update.isPending}
            onChange={(e) => update.mutate({ simplifyDebts: e.target.checked }, { onError: fail })}
          />
          Simplify debts
        </label>
        <p className="note" style={{ marginTop: 4 }}>
          On: the fewest payments overall, even between people who never shared an expense. Off: everyone pays back exactly who they owe.
        </p>
        {owner && (
          <div className="formfoot">
            <ConfirmButton
              className="btn danger"
              confirmLabel="Confirm: delete space and all its expenses"
              disabled={remove.isPending}
              onConfirm={() => remove.mutate(undefined, { onSuccess: () => { toast("Space deleted"); onDeleted(); }, onError: fail })}
            >
              Delete space
            </ConfirmButton>
            <span className="grow">Only possible once everyone is settled up.</span>
          </div>
        )}
      </div>
    </section>
  );
}
