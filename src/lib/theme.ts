// Light, dark, or follow the OS. The choice is remembered in this browser only.
import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "expense-tracker-theme";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const osDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && osDark());
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

// Several controls show the theme (account menu, Settings, sign-in page); keep them in step.
const EVENT = "expense-tracker-theme";

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readPref);
  useEffect(() => {
    const sync = () => setPref(readPref());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  useEffect(() => {
    apply(pref);
    if (pref !== "system") return;
    // Following the OS: switch live when the OS setting changes.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
  const set = (p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
    setPref(p);
    window.dispatchEvent(new Event(EVENT));
  };
  return [pref, set];
}
