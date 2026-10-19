import { useState } from "react";

type Theme = "light" | "dark";
const KEY = "expense-tracker-theme";

const current = (): Theme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
    setTheme(next);
  };
  return [theme, toggle];
}
