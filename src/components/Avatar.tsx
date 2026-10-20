import type { Me } from "../../shared/api";
import { hueFor } from "./People";

/** Initials in a tinted circle; the tint is stable per person. */
export function Avatar({ me, size = "md" }: { me: Me; size?: "md" | "lg" }) {
  const initials = me.name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <span className={`avatar ${size}`} style={{ ["--h" as string]: hueFor(me.id) }} aria-hidden="true">
      {initials}
    </span>
  );
}
