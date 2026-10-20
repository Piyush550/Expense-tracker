// The phone shortcut's two endpoints: a short list of presets ("Flat 4B · Everyone",
// "Flat 4B · Boys Flat") and adding an equal-split expense for one of them, paid by you.
import type { Me, QuickExpenseInput, QuickPreset } from "../shared/api";
import { parseDateInput } from "../shared/dates";
import { formatMoney, parseMoney } from "../shared/money";
import { quickActionGroups } from "../shared/quick-actions";
import type { Queryable } from "./db";
import { HttpError } from "./errors";
import { listSpaceGroups, loadQuickActions } from "./groups";
import { listSpaces } from "./spaces";

/** Today's date in India; the server itself runs in UTC. */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Every space you are in, as "Everyone" plus the space's quick-action groups (the same up to
 * three groups the app shows as shortcuts). Labels are made unique so they can be sent back.
 */
export async function quickPresets(q: Queryable, me: Me): Promise<QuickPreset[]> {
  const spaces = await listSpaces(q, me.id);
  const out: QuickPreset[] = [];
  const seen = new Map<string, number>();
  const label = (text: string) => {
    const n = (seen.get(text) ?? 0) + 1;
    seen.set(text, n);
    return n === 1 ? text : `${text} (${n})`;
  };
  for (const space of spaces) {
    const [members, groups, config] = await Promise.all([
      q.query<{ id: string; name: string }>(
        `SELECT u.id, u.name FROM space_members m JOIN users u ON u.id = m.user_id
          WHERE m.space_id = $1 AND m.left_at IS NULL ORDER BY lower(u.name), u.id`,
        [space.id],
      ),
      listSpaceGroups(q, space.id, me.id),
      loadQuickActions(q, space.id),
    ]);
    out.push({ id: `${space.id}.all`, label: label(`${space.name} · Everyone`), spaceId: space.id, spaceName: space.name, groupId: null, people: members.rows });
    for (const g of quickActionGroups(groups, config)) {
      if (!g.members.length) continue;
      out.push({
        id: `${space.id}.${g.id}`,
        label: label(`${space.name} · ${g.name}`),
        spaceId: space.id,
        spaceName: space.name,
        groupId: g.id,
        people: g.members.map((p) => ({ id: p.id, name: p.name })),
      });
    }
  }
  return out;
}

export function findPreset(presets: QuickPreset[], wanted: string): QuickPreset {
  const w = wanted.trim();
  const found = presets.find((p) => p.id === w) ?? presets.find((p) => p.label.toLowerCase() === w.toLowerCase());
  if (!found) throw new HttpError(422, "unknown_preset", "That choice is not available any more. Run the shortcut again.");
  return found;
}

/** Rupees from the shortcut (a number or text) → paise. */
export function quickAmount(amount: QuickExpenseInput["amount"]): number {
  const text = typeof amount === "number" ? (Number.isFinite(amount) ? String(amount) : "") : amount;
  const paise = parseMoney(text);
  if (!paise) throw new HttpError(422, "invalid_amount", "Enter an amount above zero, like 450 or 450.50.");
  return paise;
}

export function quickDate(date: string | undefined): string {
  const today = todayInIndia();
  if (!date?.trim()) return today;
  const parsed = parseDateInput(date, { today });
  if (!parsed) throw new HttpError(422, "invalid_date", "Could not read that date. Use 2026-10-21, 21 Oct, today or yesterday.");
  return parsed;
}

export function quickMessage(amountPaise: number, title: string, preset: QuickPreset, myNet: number): string {
  const n = preset.people.length;
  const split = n === 1 ? `all on ${preset.people[0]!.name}` : `split ${n} ways`;
  const standing = myNet > 0 ? `You're owed ${formatMoney(myNet)} there.` : myNet < 0 ? `You owe ${formatMoney(-myNet)} there.` : "You're square there.";
  return `Added ${formatMoney(amountPaise)} ${title} to ${preset.spaceName} · ${split}. ${standing}`;
}
