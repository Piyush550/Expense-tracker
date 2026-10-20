import type { PeopleInput, Person, PersonInvite } from "../../shared/api";

/** Names are presentation; every selection is persisted by its app user id. */
export function peopleInput(ids: string[], people: Person[], memberInvites: PersonInvite[]): PeopleInput {
  const registered = new Set(people.filter((p) => p.registered).map((p) => p.id));
  return { memberIds: ids.filter((id) => !registered.has(id)), directoryIds: ids.filter((id) => registered.has(id)), memberInvites };
}
