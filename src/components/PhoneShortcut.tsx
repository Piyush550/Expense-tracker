import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { ApiToken, NewApiToken } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { copyText } from "../lib/export";
import { keys, useTokens } from "../lib/queries";
import { useToast } from "../lib/toast";
import { Icon } from "./Icon";
import { ConfirmButton } from "./ConfirmButton";

const LIFETIMES: { days: number | null; label: string }[] = [
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: null, label: "Never expires" },
];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "never";

/**
 * Personal keys for the iPhone shortcut and AI apps (Claude, ChatGPT). A key signs in as you
 * for everything except deleting, merging people and managing keys.
 */
export function PhoneShortcut() {
  const toast = useToast();
  const qc = useQueryClient();
  const tokens = useTokens();
  const [name, setName] = useState("iPhone");
  const [lifetime, setLifetime] = useState<string>("365");
  const [fresh, setFresh] = useState<NewApiToken | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const origin = window.location.origin;
  const connector = (token: string) => `${origin}/mcp/${token}`;
  const refresh = () => qc.invalidateQueries({ queryKey: keys.tokens });
  const fail = (err: unknown) => toast(errorMessage(err));
  const show = (t: NewApiToken) => {
    setFresh(t);
    void refresh();
  };

  const create = useMutation({ mutationFn: () => api.createToken(name.trim(), lifetime === "never" ? null : Number(lifetime)), onSuccess: show, onError: fail });
  const regenerate = useMutation({ mutationFn: api.regenerateToken, onSuccess: show, onError: fail });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: { name?: string; lifetimeDays?: number | null } }) => api.updateToken(v.id, v.patch),
    onSuccess: () => { setRenaming(null); toast("Key updated"); void refresh(); },
    onError: fail,
  });
  const revoke = useMutation({ mutationFn: api.revokeToken, onSuccess: () => { toast("Key revoked. The shortcut using it stops working."); void refresh(); }, onError: fail });
  const remove = useMutation({ mutationFn: api.deleteToken, onSuccess: () => { toast("Key deleted"); void refresh(); }, onError: fail });

  const copy = async (text: string, what: string) => toast((await copyText(text)) ? `${what} copied` : "Could not copy. Select it and copy by hand.");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast("Give the key a name, like iPhone.");
    create.mutate();
  };

  return (
    <>
      <section className="card" aria-label="How the iPhone shortcut works">
        <ol className="howsteps">
          <li><span className="howicon"><Icon name="key" /></span><span><strong>Create a key</strong><span className="muted">It lets your phone add expenses as you. It can never delete anything.</span></span></li>
          <li><span className="howicon"><Icon name="phone" /></span><span><strong>Build the shortcut</strong><span className="muted">A few actions in Apple's Shortcuts app, using the key.</span></span></li>
          <li><span className="howicon"><Icon name="bolt" /></span><span><strong>Pop up after apps</strong><span className="muted">Close Swiggy or Uber, pick the space and people, type the amount. Done.</span></span></li>
          <li><span className="howicon"><Icon name="sparkle" /></span><span><strong>Or ask an AI</strong><span className="muted">Add the key to Claude or ChatGPT and say "add ₹900 dinner with Bala".</span></span></li>
        </ol>
      </section>

    <section className="card" aria-labelledby="phone-title">
      <div className="sechead"><h2 id="phone-title">Your keys</h2></div>
      <p className="muted" style={{ margin: "0 0 14px" }}>
        A key acts as you: it can read your spaces and add or edit expenses, payments and groups. It can't delete anything, merge people or manage keys. Revoke it any time; whatever uses it stops at once.
      </p>

      {fresh && (
        <div className="draftbanner" role="status" style={{ flexDirection: "column", alignItems: "stretch", marginBottom: 16 }}>
          <strong>Copy this key now. It won't be shown again.</strong>
          <div className="inline key-copy-row">
            <div className="field" style={{ minWidth: 0 }}>
              <label htmlFor="new-key">Key for "{fresh.info.name}"</label>
              <input id="new-key" type="text" readOnly value={fresh.token} className="mono" onFocus={(e) => e.currentTarget.select()} />
            </div>
            <button type="button" className="btn primary" onClick={() => copy(fresh.token, "Key")}>Copy key</button>
          </div>
          <div className="inline key-copy-row">
            <div className="field" style={{ minWidth: 0 }}>
              <label htmlFor="site-url">Your site address (the shortcut needs this too)</label>
              <input id="site-url" type="text" readOnly value={origin} className="mono" onFocus={(e) => e.currentTarget.select()} />
            </div>
            <button type="button" className="btn" onClick={() => copy(origin, "Address")}>Copy address</button>
          </div>
          <div className="inline key-copy-row">
            <div className="field" style={{ minWidth: 0 }}>
              <label htmlFor="mcp-url">Connector address for Claude or ChatGPT (holds the key, keep it private)</label>
              <input id="mcp-url" type="text" readOnly value={connector(fresh.token)} className="mono" onFocus={(e) => e.currentTarget.select()} />
            </div>
            <button type="button" className="btn" onClick={() => copy(connector(fresh.token), "Connector address")}>Copy connector</button>
          </div>
          <div><button type="button" className="btn small" onClick={() => setFresh(null)}>I've copied it</button></div>
        </div>
      )}

      <form className="inline key-create-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="key-name">New key name</label>
          <input id="key-name" type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="iPhone" />
        </div>
        <div className="field">
          <label htmlFor="key-life">Expires</label>
          <select id="key-life" value={lifetime} onChange={(e) => setLifetime(e.target.value)}>
            {LIFETIMES.map((l) => <option key={l.label} value={l.days ?? "never"}>{l.label}</option>)}
          </select>
        </div>
        <button type="submit" className="btn primary" disabled={create.isPending}>Create key</button>
      </form>

      <div style={{ marginTop: 18 }}>
        {tokens.isPending ? (
          <p className="note">Loading your keys…</p>
        ) : tokens.error ? (
          <div className="banner warn">{errorMessage(tokens.error)}</div>
        ) : !tokens.data?.length ? (
          <p className="note">No keys yet.</p>
        ) : (
          <ul className="memberlist" style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)" }}>
            {tokens.data.map((t: ApiToken) => (
              <li key={t.id} className={`memberrow token-row${t.status === "active" ? "" : " left"}`}>
                <div className="grow">
                  {renaming?.id === t.id ? (
                    <form className="inline token-rename-form" onSubmit={(e) => { e.preventDefault(); if (renaming.name.trim()) update.mutate({ id: t.id, patch: { name: renaming.name.trim() } }); }}>
                      <div className="field"><label htmlFor={`rn-${t.id}`} className="sr-only">Key name</label>
                        <input id={`rn-${t.id}`} type="text" maxLength={40} value={renaming.name} onChange={(e) => setRenaming({ id: t.id, name: e.target.value })} autoFocus /></div>
                      <button type="submit" className="btn small primary">Save</button>
                      <button type="button" className="btn small" onClick={() => setRenaming(null)}>Cancel</button>
                    </form>
                  ) : (
                    <span className="token-title">
                      <strong>{t.name}</strong>
                      <span className="tag mono">…{t.hint}</span>
                      <span className={`tag${t.status === "active" ? " accent" : ""}`}>{t.status}</span>
                    </span>
                  )}
                  <span className="muted" style={{ fontSize: 13 }}>
                    Created {when(t.createdAt)} · last used {t.lastUsedAt ? when(t.lastUsedAt) : "never"} · {t.status === "revoked" ? `revoked ${when(t.revokedAt)}` : t.expiresAt ? `expires ${when(t.expiresAt)}` : "never expires"}
                  </span>
                </div>
                <div className="token-actions" role="group" aria-label={`Actions for ${t.name}`}>
                {t.status !== "revoked" && renaming?.id !== t.id && (
                  <>
                    <button type="button" className="btn small" onClick={() => setRenaming({ id: t.id, name: t.name })}>Rename</button>
                    <select
                      aria-label={`Expiry for ${t.name}`}
                      value=""
                      onChange={(e) => e.target.value && update.mutate({ id: t.id, patch: { lifetimeDays: e.target.value === "never" ? null : Number(e.target.value) } })}
                    >
                      <option value="">Change expiry…</option>
                      {LIFETIMES.map((l) => <option key={l.label} value={l.days ?? "never"}>{l.days ? `${l.label} from today` : l.label}</option>)}
                    </select>
                    <ConfirmButton className="btn small" confirmLabel="Confirm: new key" disabled={regenerate.isPending} onConfirm={() => regenerate.mutate(t.id)}>Regenerate</ConfirmButton>
                    <ConfirmButton confirmLabel="Confirm revoke" disabled={revoke.isPending} onConfirm={() => revoke.mutate(t.id)}>Revoke</ConfirmButton>
                  </>
                )}
                {t.status !== "active" && (
                  <ConfirmButton confirmLabel="Confirm delete" disabled={remove.isPending} onConfirm={() => remove.mutate(t.id)}>Delete</ConfirmButton>
                )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

    </section>

    <section className="card">
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>How to set up the shortcut on your iPhone</summary>
        <ol className="note" style={{ paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Create a key above and copy it.</li>
          <li>In the Shortcuts app, make a shortcut named <strong>Log expense</strong> with these actions:
            <ol type="a" style={{ paddingLeft: 18 }}>
              <li><strong>Text</strong>: paste the key.</li>
              <li><strong>Choose from Menu</strong>, prompt "Spent something?", options Yes and Skip. Under Skip add <strong>Stop This Shortcut</strong>.</li>
              <li><strong>Get Contents of URL</strong>: <code>{origin}/api/quick/options</code>, header <code>Authorization</code> = <code>Bearer </code> + the Text.</li>
              <li><strong>Get Dictionary Value</strong> <code>labels</code>, then <strong>Choose from List</strong> with prompt "Which space?".</li>
              <li><strong>Get Contents of URL</strong>: <code>{origin}/api/quick/people</code>, method POST, same header, JSON body: <code>preset</code> (Text) = the chosen item.</li>
              <li><strong>Choose from List</strong> on that result, prompt "Who shared it?", with <strong>Select Multiple</strong> on.</li>
              <li><strong>Ask for Input</strong> (Number) "Amount (₹)", then <strong>Ask for Input</strong> (Text) "What for?" with default answer <strong>Shortcut Input</strong>.</li>
              <li><strong>Get Contents of URL</strong>: <code>{origin}/api/quick/expense</code>, method POST, same header, JSON body: <code>preset</code> = the space choice, <code>amount</code> (Number), <code>title</code>, <code>people</code> (Text) = the people ticked.</li>
              <li><strong>Get Dictionary Value</strong> <code>message</code>, then <strong>Show Notification</strong>.</li>
            </ol>
          </li>
          <li>In the Automation tab: <strong>App</strong> → pick Swiggy → <strong>Is Closed</strong> → Run Immediately. Add <strong>Text</strong> "Swiggy" and <strong>Run Shortcut</strong> "Log expense" with that text as input. Repeat for other apps.</li>
        </ol>
      </details>
    </section>

    <section className="card">
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>How to use it with Claude or ChatGPT</summary>
        <div className="note" style={{ lineHeight: 1.6 }}>
          <p>Create a key above (name it after the app, like "Claude") and copy its <strong>connector address</strong>: <code>{origin}/mcp/et_…</code>. Add it once on the website; the phone apps pick it up when you sign in with the same account.</p>
          <ol style={{ paddingLeft: 20 }}>
            <li><strong>Claude</strong> (claude.ai): Settings → Connectors → <strong>Add custom connector</strong>. Name: Expense Tracker. URL: the connector address. Leave the advanced settings empty, then <strong>Add</strong>. In a chat, turn it on from the tools menu.</li>
            <li><strong>ChatGPT</strong> (chatgpt.com): Settings → Apps → Advanced settings → turn on <strong>Developer mode</strong>, then <strong>Create app</strong>. Name: Expense Tracker. URL: the connector address. Authentication: <strong>No authentication</strong>. Tick that you trust it, then <strong>Create</strong>.</li>
          </ol>
          <p>Then ask things like "Who owes whom in Flat 4B this month?" or "Add ₹900 dinner yesterday, split between me and Bala". The assistant can add and edit, but never delete. To cut it off, revoke its key here.</p>
        </div>
      </details>
    </section>
    </>
  );
}
