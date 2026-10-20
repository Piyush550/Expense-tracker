import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Group, SpaceDetail, SpaceQuickActions } from "../../shared/api";
import { quickActionGroups } from "../../shared/quick-actions";
import { api, errorMessage } from "../lib/api";
import { keys, useGroups, useQuickActions, useSpaceMutation } from "../lib/queries";
import type { SplitGroup, SplitSelection } from "../lib/split-draft";
import { useToast } from "../lib/toast";
import { setParams } from "../lib/url-state";

export interface QuickConfigStatus { dirty: boolean; busy: boolean }

export function QuickActionsEditor({ spaceId, groups, config, canEdit, onDone, onStatus }: {
  spaceId: string; groups: Group[]; config: SpaceQuickActions; canEdit: boolean; onDone?(): void; onStatus?(status: QuickConfigStatus): void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState(config.mode);
  const [ids, setIds] = useState<string[]>(config.mode === "custom" ? config.groupIds.filter((id) => groups.some((g) => g.id === id)) : []);
  const [error, setError] = useState("");
  const next: SpaceQuickActions = mode === "custom" ? { mode, groupIds: ids } : { mode: "automatic" };
  const preview = quickActionGroups(groups, next);
  const save = useSpaceMutation(spaceId, (value: SpaceQuickActions) => api.saveQuickActions(spaceId, value), ["quickActions"],
    (value) => { qc.setQueryData(keys.quickActions(spaceId), value); toast("Quick actions saved"); onDone?.(); });
  const dirty = JSON.stringify(next) !== JSON.stringify(config);
  useEffect(() => { onStatus?.({ dirty, busy: save.isPending }); }, [dirty, save.isPending, onStatus]);
  useEffect(() => () => onStatus?.({ dirty: false, busy: false }), [onStatus]);
  const root = useRef<HTMLElement>(null);
  useEffect(() => { if (onDone) root.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }); }, []);
  const toggle = (id: string) => setIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 3 ? [...current, id] : current);
  const move = (id: string, direction: number) => setIds((current) => {
    const next = [...current]; const index = next.indexOf(id); const target = index + direction;
    if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
  return <section ref={root} className="quick-config" aria-label="Configure quick groups">
    <div className="quick-config-heading"><h3>{onDone ? "Edit quick groups" : "Group shortcuts"}</h3>{onDone && <button type="button" className="linkbtn" disabled={save.isPending} onClick={onDone}>Back to split</button>}</div>
    <p className="note">Shared with everyone in this space. Show up to three groups in the expense forms.</p>
    {!canEdit && <p className="note">Only space owners can change these shortcuts.</p>}
    <fieldset disabled={!canEdit || save.isPending} className="quick-config-fields">
      <label className="quick-mode"><input type="radio" name={`quick-mode-${spaceId}`} checked={mode === "automatic"} onChange={() => setMode("automatic")} /><span><strong>Use latest groups</strong><small>The newest three by creation date. Updates as groups are created.</small></span></label>
      <label className="quick-mode"><input type="radio" name={`quick-mode-${spaceId}`} checked={mode === "custom"} onChange={() => { setMode("custom"); if (!ids.length) setIds(quickActionGroups(groups, { mode: "automatic" }).map((g) => g.id)); }} /><span><strong>Choose groups</strong><small>Keep your preferred groups and set their order.</small></span></label>
      {mode === "custom" && <>
        <div className="quick-config-count">{ids.length} of 3 selected</div>
        <div className="quick-config-list">{groups.map((group) => <label key={group.id} className="quick-config-option"><input type="checkbox" checked={ids.includes(group.id)} disabled={!ids.includes(group.id) && ids.length === 3} onChange={() => toggle(group.id)} /><span><strong>{group.name}</strong><small>{group.members.map((m) => m.name).join(", ") || "No current members"}</small></span></label>)}</div>
        {!!ids.length && <ol className="quick-order" aria-label="Shortcut order">{ids.map((id, index) => <li key={id}><span>{index + 1}. {groups.find((g) => g.id === id)?.name}</span><button type="button" className="iconbtn" aria-label={`Move ${groups.find((g) => g.id === id)?.name} earlier`} disabled={index === 0} onClick={() => move(id, -1)}>↑</button><button type="button" className="iconbtn" aria-label={`Move ${groups.find((g) => g.id === id)?.name} later`} disabled={index === ids.length - 1} onClick={() => move(id, 1)}>↓</button></li>)}</ol>}
      </>}
    </fieldset>
    <div className="quick-preview"><span className="lbl">Preview</span><div className="quick-group-row">{preview.map((g) => <span key={g.id} className="quick-group-chip">{g.name} · {g.members.length}</span>)}{!preview.length && <span className="note">Create a group in this space to see shortcuts here.</span>}</div></div>
    {canEdit && <div className="quick-config-footer"><span className="err" role="alert">{error || (save.error ? errorMessage(save.error) : "")}</span><button type="button" className="btn primary" disabled={save.isPending || (mode === "custom" && !groups.length)} onClick={() => {
      if (mode === "custom" && !ids.length) return setError("Choose one to three groups, or use latest groups.");
      setError(""); save.mutate(next);
    }}>{save.isPending ? "Saving…" : "Save shortcuts"}</button></div>}
  </section>;
}

export function QuickActionsTab({ space }: { space: SpaceDetail }) {
  const groups = useGroups(space.id);
  const config = useQuickActions(space.id);
  const error = groups.error ?? config.error;
  return <section className="sec quick-actions-tab"><div className="page-heading"><div><h2>Quick actions</h2><p>Fast group picks for {space.name}. Each transaction keeps its own selection.</p></div><button type="button" className="btn" onClick={() => setParams({ v: null, t: "groups" })}>Manage groups</button></div>
    {error ? <div className="banner warn">{errorMessage(error)} <button type="button" className="linkbtn" onClick={() => void Promise.all([groups.refetch(), config.refetch()])}>Try again</button></div> : groups.data && config.data ? <div className="card"><QuickActionsEditor key={JSON.stringify(config.data)} spaceId={space.id} groups={groups.data} config={config.data} canEdit={space.myRole === "owner"} /></div> : <p className="muted">Loading shortcuts…</p>}
  </section>;
}

/** Same row in both pickers; using a shortcut never changes the active picker view. */
export function QuickGroupOptions({ spaceId, groups, selection, onToggle, canConfigure, disabled, onStatus }: {
  spaceId: string; groups: SplitGroup[]; selection: SplitSelection; onToggle(group: SplitGroup): void; canConfigure: boolean; disabled: boolean; onStatus?(status: QuickConfigStatus): void;
}) {
  const all = useGroups(spaceId);
  const config = useQuickActions(spaceId);
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const close = () => { setEditing(false); requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true })); };
  if (all.error || config.error) return <div className="quick-shortcut-error">Shortcuts unavailable. <button type="button" className="linkbtn" onClick={() => void Promise.all([all.refetch(), config.refetch()])}>Retry</button></div>;
  if (!all.data || !config.data) return <div className="quick-shortcut-loading" role="status">Loading quick groups…</div>;
  if (!all.data.length) return <p className="quick-shortcut-empty">No groups in this space yet. Create one in this space’s Groups tab.</p>;
  const quick = quickActionGroups(all.data, config.data).flatMap((g) => { const match = groups.find((item) => item.id === g.id); return match ? [match] : []; });
  return <div className={`quick-shortcuts${editing ? " editing" : ""}`}>
    {editing ? <QuickActionsEditor key={JSON.stringify(config.data)} spaceId={spaceId} groups={all.data} config={config.data} canEdit={canConfigure} onDone={close} onStatus={onStatus} /> : <>
      <div className="quick-shortcuts-label"><span>Quick groups</span>{canConfigure && <button ref={editButton} type="button" className="linkbtn" disabled={disabled} onClick={() => setEditing(true)}>Edit</button>}</div>
      <div className="quick-group-row" role="group" aria-label="Quick groups">{quick.map((group) => {
        const selected = selection.selectedGroups?.some((item) => item.id === group.id) ?? false;
        return <button key={group.id} type="button" className="quick-group-chip" aria-label={`Quick group ${group.name}, ${group.ids.length} ${group.ids.length === 1 ? "person" : "people"}`} aria-pressed={selected} disabled={disabled || (!group.ids.length && !selected)} title={`${group.name}: ${group.ids.map((id) => all.data!.find((g) => g.id === group.id)?.members.find((m) => m.id === id)?.name ?? "Former member").join(", ")}`} onClick={() => onToggle(group)}><span aria-hidden="true">{selected ? "✓" : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M20 20v-2a6 6 0 0 0-3-5" /></svg>}</span><span className="quick-chip-name">{group.name}</span><span className="quick-chip-count">· {group.ids.length}</span></button>;
      })}</div>
    </>}
  </div>;
}
