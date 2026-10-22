import { useState, type FormEvent } from "react";
import type { InitialSpaceGroup, Me, PersonInvite, SpaceDetail, SpaceKind } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { setSpaceDetail, useSelectablePeople, useSpaceMutation } from "../lib/queries";
import { useToast } from "../lib/toast";
import { peopleInput } from "../lib/people";
import { PeoplePicker } from "./PeoplePicker";
import { PeopleSelect } from "./PeopleSelect";

export function NewSpaceForm({ me, onDone, onCancel, initialMemberIds = [] }: { me: Me; onDone(space: SpaceDetail): void; onCancel?: () => void; initialMemberIds?: string[] }) {
  const toast = useToast();
  const people = useSelectablePeople();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SpaceKind>("recurring");
  const [ids, setIds] = useState<string[]>(initialMemberIds);
  const [invites, setInvites] = useState<PersonInvite[]>([]);
  const [groups, setGroups] = useState<InitialSpaceGroup[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupPeople, setGroupPeople] = useState<string[]>([]);
  const [customQuick, setCustomQuick] = useState(false);
  const [quickIds, setQuickIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [invitationPending, setInvitationPending] = useState(false);
  const create = useSpaceMutation(null, api.createSpace, ["spaces", "people"], setSpaceDetail);
  const selectedPeople = [me, ...people.data.filter((p) => ids.includes(p.id) && p.id !== me.id)];
  const memberSet = new Set(selectedPeople.map((p) => p.id));
  const resetGroup = () => { setEditingId(null); setGroupName(""); setGroupPeople([]); };
  const saveGroup = () => {
    if (!groupName.trim()) return setError("Give the group a name.");
    if (!groupPeople.length) return setError("Choose at least one person for the group.");
    const group = { id: editingId ?? crypto.randomUUID(), name: groupName.trim(), memberIds: groupPeople };
    setGroups((current) => editingId ? current.map((item) => item.id === editingId ? group : item) : [...current, group]);
    resetGroup(); setError("");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending || people.isPending || people.error) return;
    if (step === 0) {
      if (invitationPending) return setError("Add or cancel the pending invitation first.");
      if (!name.trim()) return setError("Give the space a name.");
      setGroups((current) => current.map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => memberSet.has(id)) })));
      setError(""); setStep(1); return;
    }
    if (groupName.trim() || groupPeople.length || editingId) return setError("Save or cancel the group being edited first.");
    if (groups.some((g) => !g.memberIds.length)) return setError("Some groups no longer have any people. Edit or remove them first.");
    if (step === 1) { setError(""); setStep(2); return; }
    if (customQuick && !quickIds.length) return setError("Choose one to three groups, or use latest groups.");
    setError("");
    create.mutate({ name: name.trim(), kind, ...peopleInput(ids, people.data, invites), initialGroups: groups, quickGroupIds: customQuick ? quickIds : [] }, {
      onSuccess: (s) => { toast("Space created"); onDone(s); }, onError: (err) => setError(errorMessage(err)),
    });
  };
  return <form className="card formcard space-onboarding" onSubmit={submit} noValidate>
    <div className="sechead"><h2>New space</h2><span className="muted">Step {step + 1} of 3</span></div>
    <ol className="onboarding-steps" aria-label="Space setup steps">{["Details & people", "Groups", "Quick actions"].map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className={index <= step ? "on" : ""}><span>{index + 1}</span>{label}</li>)}</ol>
    {step === 0 && <div className="onboarding-content">
      <div className="field"><label htmlFor="s-name">Space name</label><input id="s-name" type="text" maxLength={60} placeholder="Flat groceries, Goa trip…" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
      <div className="field"><div className="legend">Kind</div><div className="kindpick" role="radiogroup" aria-label="Kind of space">
        <label className={`kindopt${kind === "recurring" ? " on" : ""}`}><input type="radio" name="kind" checked={kind === "recurring"} onChange={() => setKind("recurring")} /><strong>Recurring</strong><span className="muted">Same people every month, settled month by month. Like flat groceries.</span></label>
        <label className={`kindopt${kind === "one_time" ? " on" : ""}`}><input type="radio" name="kind" checked={kind === "one_time"} onChange={() => setKind("one_time")} /><strong>One-time</strong><span className="muted">Settled once at the end. Like a trip or a party.</span></label>
      </div></div>
      <PeoplePicker onPendingChange={setInvitationPending} legend="Add people" ids={ids} onIds={setIds} invites={invites} onInvites={setInvites} />
      <p className="note">You will be the owner. Everyone in the space can add expenses and use its groups. No invitation emails are sent.</p>
    </div>}
    {step === 1 && <div className="onboarding-content"><div><h3>Make your usual groups</h3><p className="note">Optional. Choose combinations of {name || "this space"}’s people for one-click splits. You can add groups later.</p></div>
      {groups.map((group) => <div className="onboarding-group" key={group.id}><div><strong>{group.name}</strong><span>{group.memberIds.map((id) => selectedPeople.find((p) => p.id === id)?.name).filter(Boolean).join(", ") || "Choose people for this group"}</span></div><button type="button" className="linkbtn" onClick={() => { setEditingId(group.id); setGroupName(group.name); setGroupPeople(group.memberIds); setError(""); }}>Edit</button><button type="button" className="linkbtn" aria-label={`Remove group ${group.name}`} onClick={() => { setGroups((current) => current.filter((g) => g.id !== group.id)); setQuickIds((current) => current.filter((id) => id !== group.id)); if (editingId === group.id) resetGroup(); }}>Remove</button></div>)}
      <div className="onboarding-group-editor"><div className="field"><label htmlFor="onboard-group-name">{editingId ? "Edit group name" : "New group name"}</label><input id="onboard-group-name" maxLength={60} placeholder="Flatmates, Food, Weekend…" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></div><PeopleSelect people={selectedPeople} ids={groupPeople} onIds={setGroupPeople} label="Group members" /><div className="headbtns"><button type="button" className="btn small" disabled={groups.length >= 20 && !editingId} onClick={saveGroup}>{editingId ? "Save group" : "Add group"}</button>{(editingId || groupName || groupPeople.length > 0) && <button type="button" className="linkbtn" onClick={() => { resetGroup(); setError(""); }}>Cancel group</button>}</div></div>
      {!!invites.length && <p className="note">People invited by email can be added to groups from this space’s Groups tab after the space is created.</p>}
    </div>}
    {step === 2 && <div className="onboarding-content"><div><h3>Keep your groups handy</h3><p className="note">Optional. Up to three group shortcuts appear above the people list in both expense forms.</p></div>
      <label className="quick-mode"><input type="radio" name="onboarding-shortcuts" checked={!customQuick} onChange={() => setCustomQuick(false)} /><span><strong>Use latest groups</strong><small>Show the newest three automatically, including groups added later.</small></span></label>
      {groups.length > 0 && <label className="quick-mode"><input type="radio" name="onboarding-shortcuts" checked={customQuick} onChange={() => setCustomQuick(true)} /><span><strong>Choose groups</strong><small>Select up to three, in the order you want them shown.</small></span></label>}
      {customQuick && <div className="quick-config-list">{groups.map((g) => <label key={g.id} className="quick-config-option"><input type="checkbox" aria-label={`Shortcut ${g.name}`} checked={quickIds.includes(g.id)} disabled={!quickIds.includes(g.id) && quickIds.length >= 3} onChange={() => setQuickIds((current) => current.includes(g.id) ? current.filter((id) => id !== g.id) : [...current, g.id])} /><span><strong>{g.name}{quickIds.includes(g.id) ? ` · ${quickIds.indexOf(g.id) + 1}` : ""}</strong><small>{g.memberIds.length} {g.memberIds.length === 1 ? "person" : "people"}</small></span></label>)}</div>}
      <div className="quick-preview"><span className="lbl">Shortcut preview</span><div className="quick-group-row">{(customQuick ? quickIds.flatMap((id) => groups.filter((g) => g.id === id)) : groups.slice(-3).reverse()).map((g) => <span key={g.id} className="quick-group-chip">{g.name} · {g.memberIds.length}</span>)}{!groups.length && <p className="note">Create groups later. Your newest three will appear here automatically.</p>}</div></div>
    </div>}
    <p className="err" role="alert">{error}</p>
    <div className="formfoot">{step > 0 && <button type="button" className="btn" disabled={create.isPending} onClick={() => { setStep(step - 1); setError(""); }}>Back</button>}<button type="submit" className="btn primary" disabled={create.isPending || people.isPending || !!people.error || (step === 0 && invitationPending)}>{create.isPending ? "Creating…" : step === 2 ? "Create space" : step === 1 && !groups.length ? "Skip groups" : "Continue"}</button>{onCancel && <button type="button" className="btn" disabled={create.isPending} onClick={onCancel}>Cancel</button>}</div>
  </form>;
}
