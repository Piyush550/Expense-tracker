import { useEffect, useId, useRef, useState } from "react";
import type { Me } from "../../shared/api";
import { useAuth } from "../lib/auth";
import { useTheme, type ThemePref } from "../lib/theme";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

export type SettingsTab = "profile" | "appearance" | "shortcut";

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Auto" },
];

/**
 * The bottom-left of the sidebar: who you are, as one button. It opens a small menu with
 * your settings pages, the theme, and sign out.
 */
export function AccountMenu({ me, active, onOpen }: { me: Me; active: boolean; onOpen(tab: SettingsTab): void }) {
  const auth = useAuth();
  const [pref, setPref] = useTheme();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Close on a click outside or Escape (focus goes back to the button).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = (tab: SettingsTab) => {
    setOpen(false);
    onOpen(tab);
  };

  return (
    <div
      ref={root}
      className="acctmenu"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      {open && (
        <div id={menuId} className="acctpop" role="menu" aria-label="Account">
          <button type="button" role="menuitem" className="acctitem" onClick={() => go("profile")}>
            <Icon name="user" /> <span>Profile</span>
          </button>
          <button type="button" role="menuitem" className="acctitem" onClick={() => go("shortcut")}>
            <Icon name="phone" /> <span>iPhone & AI apps</span>
          </button>
          <button type="button" role="menuitem" className="acctitem" onClick={() => go("appearance")}>
            <Icon name="palette" /> <span>Appearance</span>
          </button>
          <div className="accttheme" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} type="button" aria-pressed={pref === t.id} onClick={() => setPref(t.id)} title={t.id === "system" ? "Follow this device" : `${t.label} theme`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="acctsep" role="separator" />
          <button type="button" role="menuitem" className="acctitem danger" onClick={() => auth.signOut()}>
            <Icon name="logout" /> <span>Sign out</span>
          </button>
        </div>
      )}
      <button
        ref={button}
        type="button"
        className={`acctbtn${active ? " on" : ""}${open ? " open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Avatar me={me} />
        <span className="stack">
          <strong>{me.name}</strong>
          <span>{me.email}</span>
        </span>
        <Icon name={open ? "chevronDown" : "chevronUp"} size={16} className="caret" />
      </button>
    </div>
  );
}
