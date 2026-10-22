import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { Me } from "../../shared/api";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { keys } from "../lib/queries";
import { useTheme, type ThemePref } from "../lib/theme";
import { useToast } from "../lib/toast";
import type { SettingsTab } from "./AccountMenu";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { PhoneShortcut } from "./PhoneShortcut";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "shortcut", label: "iPhone & AI apps" },
];

/** Settings: your profile, how the app looks, and keys for the iPhone shortcut and AI apps. */
export function SettingsPage({ me, tab, onTab }: { me: Me; tab: SettingsTab; onTab(tab: SettingsTab): void }) {
  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="spacehead">
        <div>
          <h1 id="settings-title" className="spacetitle">Settings</h1>
          <p className="sub">Your profile, how the app looks, and adding expenses from your iPhone or an AI assistant.</p>
        </div>
      </div>
      <div className="subtabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="tabpanel settingspanel">
        {tab === "profile" && <ProfileSettings me={me} />}
        {tab === "appearance" && <AppearanceSettings />}
        {tab === "shortcut" && <PhoneShortcut />}
      </div>
    </section>
  );
}

function ProfileSettings({ me }: { me: Me }) {
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(me.name);
  const providers = auth.user?.providerData.map((p) => p.providerId) ?? [];
  const method = providers.includes("google.com") ? "Google" : providers.includes("password") ? "Email and password" : "Signed in";
  const save = useMutation({
    mutationFn: (n: string) => api.updateMe(n),
    onSuccess: (updated) => {
      qc.setQueryData(keys.me, updated);
      void qc.invalidateQueries({ queryKey: ["space"] });
      void qc.invalidateQueries({ queryKey: keys.people });
      auth.setDisplayName(updated.name).catch(() => {}); // the API copy is what others see
      toast("Name updated");
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const changed = name.trim() !== "" && name.trim() !== me.name;

  return (
    <>
      <section className="card profilecard" aria-label="Your account">
        <Avatar me={me} size="lg" />
        <div className="stack">
          <strong>{me.name}</strong>
          <span className="muted">{me.email}</span>
          <span className="tag accent signedwith">
            <Icon name={method === "Google" ? "user" : "mail"} size={12} /> {method}
          </span>
        </div>
      </section>

      <form className="card settingsform" onSubmit={(e: FormEvent) => { e.preventDefault(); if (changed) save.mutate(name.trim()); }} noValidate>
        <div className="sechead"><h2>Display name</h2></div>
        <div className="inline">
          <div className="field">
            <label htmlFor="n-name">Shown to everyone in your spaces, on expenses and balances</label>
            <input id="n-name" type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <button type="submit" className="btn primary" disabled={save.isPending || !changed}>{save.isPending ? "Saving…" : "Save name"}</button>
        </div>
      </form>

      <section className="card settingsrow">
        <div className="stack">
          <strong>Sign out</strong>
          <span className="muted">Signs out on this device and clears the data saved in this browser.</span>
        </div>
        <button type="button" className="btn" onClick={() => auth.signOut()}>
          <Icon name="logout" size={16} /> Sign out
        </button>
      </section>
    </>
  );
}

const THEMES: { id: ThemePref; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "Always light" },
  { id: "dark", label: "Dark", hint: "Always dark" },
  { id: "system", label: "Auto", hint: "Follows your device" },
];

/** A tiny drawing of the app in a theme, so the choice is visual. */
function ThemePreview({ mode }: { mode: "light" | "dark" }) {
  return (
    <span className={`themepreview ${mode}`} aria-hidden="true">
      <span className="tp-side"><i /><i /><i /></span>
      <span className="tp-main"><i className="tp-title" /><i /><i className="tp-short" /><b /></span>
    </span>
  );
}

function AppearanceSettings() {
  const [pref, setPref] = useTheme();
  return (
    <section className="card">
      <div className="sechead"><h2>Theme</h2></div>
      <div className="themecards" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={pref === t.id} className={`themecard${pref === t.id ? " on" : ""}`} onClick={() => setPref(t.id)}>
            {t.id === "system" ? (
              <span className="themesplit"><ThemePreview mode="light" /><ThemePreview mode="dark" /></span>
            ) : (
              <ThemePreview mode={t.id} />
            )}
            <span className="themelabel">
              <span><strong>{t.label}</strong><span className="muted">{t.hint}</span></span>
              {pref === t.id && <Icon name="check" size={18} className="themecheck" />}
            </span>
          </button>
        ))}
      </div>
      <p className="note">Saved in this browser. Auto switches with your device's light or dark setting.</p>
    </section>
  );
}
