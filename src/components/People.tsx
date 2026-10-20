import { createContext, useContext } from "react";
import type { Member } from "../../shared/api";

/** Everyone the current group knows about, including former members named on old expenses. */
export const PeopleContext = createContext<Map<string, Member>>(new Map());

export function usePeople() {
  return useContext(PeopleContext);
}

export function useName() {
  const people = usePeople();
  return (id: string) => people.get(id)?.name ?? "Former member";
}

const HUES = [222, 18, 152, 292, 42, 188, 340, 96, 262, 8, 72, 322];
export function hueFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return HUES[Math.abs(h) % HUES.length];
}

export function Chip({ id, small }: { id: string; small?: boolean }) {
  const name = usePeople().get(id)?.name ?? "?";
  return (
    <span className={`chip${small ? " sm" : ""}`} style={{ ["--h" as string]: hueFor(id) }} aria-hidden="true">
      {name.trim().slice(0, 2)}
    </span>
  );
}

export function Who({ id, you }: { id: string; you?: string }) {
  const name = useName()(id);
  return (
    <span className="who">
      <Chip id={id} />
      <strong>
        {name}
        {id === you ? " (you)" : ""}
      </strong>
    </span>
  );
}
