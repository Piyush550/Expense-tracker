// The MCP server, so Claude or ChatGPT can read and add expenses as you. It signs in with a
// personal key (the same "et_" keys as the iPhone shortcut), sent as "Authorization: Bearer et_…"
// or as the last part of the address (/mcp/et_…) for apps that can't send headers. Every tool
// calls the normal API in-process with that key, so a key's limits (no deleting, no merging,
// no key management), membership checks and validation all apply unchanged.
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DirectoryPage, DirectoryPerson, Balances, Expense, ExpensePage, Group, Me, Member, Settlement, SettlementPage, SpaceDetail, SpaceSummary } from "../shared/api";
import { MONTH_RE, monthLabel, shiftMonth } from "../shared/dates";
import { formatMoney, MAX_AMOUNT_PAISE } from "../shared/money";
import { PERCENT_TOTAL, type SplitType } from "../shared/split";
import { quickDate, todayInIndia } from "./quick";
import { TOKEN_PREFIX } from "./tokens";

type FetchApi = (req: Request) => Response | Promise<Response>;

const VERSION = "1.1.0";
const INSTRUCTIONS = `Expense Tracker: shared expenses in "spaces" (a flat, a trip), split between people.
Amounts are in rupees (₹). People and spaces are named by name; "me" means the signed-in user.
Start with list_spaces. Before adding expenses, check names with get_space if unsure.
Defaults when the user doesn't say: they paid, it is split equally between everyone in the space, dated today. Use them and mention them in your reply; don't ask about them.
split_between is exactly who shares the cost. "Split with Chen" or "split with Boys" means only Chen or only the Boys group: don't add the payer or the user unless they say "me", "us" or "between me and …".
Ask only when the amount or what it was for is missing, or a name doesn't match. Never guess an amount. Amounts have at most 2 decimals (paise); if the user gives more, ask instead of rounding.
To edit, read the expense first and send the version you saw. Payments are listed with list_payments.
To find registered platform users use list_people (names and app IDs, never emails). To create a space use create_space: the caller is automatically its owner. Resolve members from list_people, clarify ambiguous names, and never create placeholder people or guess an email. Omitted kind means recurring (monthly); use one_time for a trip or event. Use a fresh request_id for each intended space creation and preserve it when retrying the same request. Groups and shortcuts can be configured in the app after creation.
This connector cannot delete anything; for that, use the app.`;

/** A readable failure; becomes the tool's error text. */
class ToolError extends Error {}

/** Calls the Expense Tracker API in-process, signed in with the caller's key. */
class Api {
  constructor(
    private readonly fetchApi: FetchApi,
    private readonly key: string,
  ) {}

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.key}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchApi(
      new Request(`http://internal/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const message = (data as { error?: { message?: string } } | null)?.error?.message;
      // Whole-body validation messages arrive as "body: …"; the prefix means nothing to a person.
      throw new ToolError(message?.replace(/^body: /, "") ?? `The app answered ${res.status}.`);
    }
    return data as T;
  }
}

// ── Finding things by name ────────────────────────────────────────────────────────────────
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const ME_WORDS = new Set(["me", "i", "myself", "self", "you"]);
const EVERYONE_WORDS = new Set(["everyone", "all", "everybody", "all of us", "us"]);

/** The one item whose name matches: exact, then first word, then a unique part. */
function pickByName<T>(items: T[], wanted: string, name: (t: T) => string, what: string, where: string): T {
  const w = norm(wanted);
  const tiers = [
    items.filter((t) => norm(name(t)) === w),
    items.filter((t) => norm(name(t)).split(" ")[0] === w),
    items.filter((t) => norm(name(t)).includes(w)),
  ];
  for (const found of tiers) {
    if (found.length === 1) return found[0]!;
    if (found.length > 1) throw new ToolError(`"${wanted}" could be ${found.map((t) => `"${name(t)}"`).join(" or ")} in ${where}. Use the full name.`);
  }
  const all = items.map((t) => `"${name(t)}"`).join(", ");
  throw new ToolError(`No ${what} called "${wanted}" in ${where}.${all ? ` Choose from: ${all}.` : ""}`);
}

async function findSpace(api: Api, wanted: string): Promise<SpaceSummary> {
  const spaces = await api.call<SpaceSummary[]>("GET", "/spaces");
  if (!spaces.length) throw new ToolError("You aren't in any space yet. Use create_space or create one in the app first.");
  return spaces.find((s) => s.id === wanted.trim()) ?? pickByName(spaces, wanted, (s) => s.name, "space", "your spaces");
}

interface Space {
  detail: SpaceDetail;
  groups: Group[];
  me: Me;
  name(id: string): string;
}

async function loadSpace(api: Api, me: Me, wanted: string): Promise<Space> {
  const summary = await findSpace(api, wanted);
  const [detail, groups] = await Promise.all([
    api.call<SpaceDetail>("GET", `/spaces/${summary.id}`),
    api.call<Group[]>("GET", `/spaces/${summary.id}/groups`),
  ]);
  const names = new Map(detail.members.map((m) => [m.id, m.id === me.id ? `${m.name} (you)` : m.name]));
  return { detail, groups, me, name: (id) => names.get(id) ?? "someone who left" };
}

/**
 * A member by name, email, id, or "me". New expenses and payments take only current members by
 * name (anyone by id); `former` also finds people who have left, for reading their history.
 */
function findMember(space: Space, wanted: string, former = false): Member {
  const w = norm(wanted);
  const byId = space.detail.members.find((m) => m.id === wanted.trim());
  if (byId) return byId;
  const members = space.detail.members.filter((m) => former || m.active);
  if (ME_WORDS.has(w)) {
    const me = members.find((m) => m.id === space.me.id);
    if (!me) throw new ToolError(`You aren't a member of ${space.detail.name}.`);
    return me;
  }
  return (
    members.find((m) => m.email !== null && m.email.toLowerCase() === w) ??
    pickByName(members, wanted, (m) => m.name, "person", space.detail.name)
  );
}

/** A member matched closely (me, id, email, full name or first name), for spotting name clashes with groups. */
function closeMember(space: Space, wanted: string): Member | null {
  const w = norm(wanted);
  const active = space.detail.members.filter((m) => m.active);
  if (ME_WORDS.has(w)) return active.find((m) => m.id === space.me.id) ?? null;
  const hits = active.filter((m) => m.id === wanted.trim() || m.email?.toLowerCase() === w || norm(m.name) === w || norm(m.name).split(" ")[0] === w);
  return hits.length === 1 ? hits[0]! : null;
}

/** A group's current members; a group whose people have all left can't be split with. */
function groupMembers(space: Space, group: Group): Member[] {
  const active = space.detail.members.filter((m) => m.active);
  const members = active.filter((m) => group.members.some((p) => p.id === m.id));
  if (!members.length) throw new ToolError(`The group "${group.name}" has no current members in ${space.detail.name}. Name the people instead.`);
  return members;
}

/**
 * People for an equal split: names, group names or "everyone"; leaving it out means everyone.
 * "group:Name" and "person:Name" pick explicitly. Anything that could mean two different sets
 * of people (a person and a group with the same name, two groups with one name, a group called
 * "Everyone") is refused with the choices, never guessed.
 */
function findPeople(space: Space, wanted: string[] | undefined): Member[] {
  const active = space.detail.members.filter((m) => m.active);
  if (wanted === undefined) return active;
  if (!wanted.some((w) => w.trim())) {
    throw new ToolError("No one was picked to share this. Name at least one person or group, or leave split_between out to split with everyone.");
  }
  const out = new Map<string, Member>();
  const add = (ms: Member[]) => ms.forEach((m) => out.set(m.id, m));
  const describe = (g: Group) => `"${g.name}" (${g.members.map((p) => space.name(p.id)).join(", ") || "nobody"})`;
  for (const raw of wanted) {
    const prefix = /^(group|person)\s*:\s*(.+)$/i.exec(raw.trim());
    const w = norm(prefix ? prefix[2]! : raw);
    if (!w) continue;
    const groups = space.groups.filter((g) => norm(g.name) === w);
    if (prefix?.[1]!.toLowerCase() === "person") {
      add([findMember(space, prefix[2]!)]);
      continue;
    }
    if (groups.length > 1) {
      throw new ToolError(`There are ${groups.length} groups called "${groups[0]!.name}" in ${space.detail.name}: ${groups.map(describe).join(" and ")}. Name the people instead.`);
    }
    if (prefix?.[1]!.toLowerCase() === "group") {
      if (!groups.length) throw new ToolError(`No group called "${prefix[2]}" in ${space.detail.name}. Groups: ${space.groups.map((g) => g.name).join(", ") || "none"}.`);
      add(groupMembers(space, groups[0]!));
      continue;
    }
    const group = groups[0];
    if (EVERYONE_WORDS.has(w)) {
      if (group) throw new ToolError(`"${raw}" could mean everyone in ${space.detail.name} or the group ${describe(group)}. Use "group:${group.name}" for the group, or leave split_between out for everyone.`);
      add(active);
      continue;
    }
    if (group) {
      const person = closeMember(space, w);
      if (person) {
        throw new ToolError(`"${raw}" is both the person ${space.name(person.id)} and the group ${describe(group)}. Use "person:${person.name}" or "group:${group.name}".`);
      }
      add(groupMembers(space, group));
      continue;
    }
    add([findMember(space, raw)]);
  }
  return [...out.values()];
}

/** Resolve a registered platform member without exposing email or scanning an unbounded directory. */
async function findRegisteredPerson(api: Api, me: Me, wanted: string): Promise<DirectoryPerson> {
  if (ME_WORDS.has(norm(wanted)) || wanted.trim() === me.id) return { id: me.id, name: me.name };
  const params = new URLSearchParams({ search: wanted.trim(), limit: "200" });
  const page = await api.call<DirectoryPage>("GET", `/people/directory/page?${params}`);
  if (page.total > page.people.length) throw new ToolError(`Too many people match "${wanted}". Use a full name or an app ID from list_people.`);
  const byId = page.people.find((p) => p.id === wanted.trim());
  if (byId) return byId;
  try {
    return pickByName(page.people, wanted, (p) => p.name, "registered person", "the platform");
  } catch (err) {
    if (err instanceof ToolError) throw new ToolError(`${err.message} Use list_people to find the full name or app ID; only registered users can be added here.`);
    throw err;
  }
}

// ── Money, dates, months ──────────────────────────────────────────────────────────────────
/** Rupees → paise. More than 2 decimals is refused rather than silently rounded. */
function paise(rupees: number, what = "The amount", allowZero = false): number {
  const exact = rupees * 100;
  const p = Math.round(exact);
  if (!Number.isFinite(p) || p < 0 || (!allowZero && p === 0)) throw new ToolError(`${what} must be above zero.`);
  if (Math.abs(exact - p) > 1e-6) {
    throw new ToolError(`${what} (₹${rupees}) has more than 2 decimal places. Amounts are kept to the paisa, e.g. ₹1.00 or ₹1.01: ask which to use.`);
  }
  if (p > MAX_AMOUNT_PAISE) throw new ToolError(`${what} is too large.`);
  return p;
}

function toDate(text: string | undefined): string {
  try {
    return quickDate(text);
  } catch {
    throw new ToolError(`Could not read the date "${text}". Use 2026-10-21, 21 Oct, today or yesterday.`);
  }
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "2026-10", "this month", "last month", "October", "Oct 2026" → "YYYY-MM". */
function toMonth(text: string | undefined): string | undefined {
  const s = norm(text ?? "");
  if (!s || s === "all" || s === "all time") return undefined;
  const current = todayInIndia().slice(0, 7);
  if (MONTH_RE.test(s)) return s;
  if (s === "this month" || s === "current month") return current;
  if (s === "last month" || s === "previous month") return shiftMonth(current, -1);
  const m = /^([a-z]{3,9})\.?(?:\s+(\d{4}))?$/.exec(s);
  // "oct", "octo", "october": at least three letters, and only a beginning of the real name.
  const index = m ? MONTH_NAMES.findIndex((n) => n.startsWith(m[1]!)) : -1;
  if (m && index >= 0) {
    const mm = String(index + 1).padStart(2, "0");
    if (m[2]) return `${m[2]}-${mm}`;
    // Without a year: the most recent such month, never one in the future.
    const thisYear = `${current.slice(0, 4)}-${mm}`;
    return thisYear <= current ? thisYear : `${Number(current.slice(0, 4)) - 1}-${mm}`;
  }
  throw new ToolError(`Could not read the month "${text}". Use 2026-10, October, this month or last month.`);
}

// ── Building and describing expenses ──────────────────────────────────────────────────────
const SPLIT_TYPES = ["equal", "exact", "percent", "shares"] as const;

const splitValue = z.strictObject({
  person: z.string().min(1).describe('A name in the space, or "me".'),
  value: z.number().min(0).describe("exact: rupees this person owes (at most 2 decimals) · percent: their percent (all add up to 100) · shares: how many shares, a whole number (e.g. 2 for a couple)"),
});

const expenseShape = {
  description: z.string().trim().min(1).max(100).describe("What it was for, e.g. Groceries."),
  amount: z.number().positive().describe("Total in rupees, at most 2 decimals, e.g. 450 or 450.50."),
  paid_by: z.string().optional().describe('Who paid: a name in the space. Defaults to "me".'),
  split_between: z
    .array(z.string())
    .max(100)
    .optional()
    .describe(
      'Exactly who shares the cost, as names or group names; only these people get a share (the payer and "me" are not added unless listed). Leave out to split with everyone in the space. Use "group:Name" or "person:Name" when a name could be either.',
    ),
  split_type: z.enum(SPLIT_TYPES).optional().describe("How to divide it. Defaults to equal."),
  split_values: z.array(splitValue).max(100).optional().describe("Needed when split_type is exact, percent or shares: one entry per person who owes a part."),
  date: z.string().max(40).optional().describe("When: 2026-10-21, 21 Oct, today or yesterday. Defaults to today (India time)."),
  notes: z.string().max(500).optional().describe("Any extra note."),
};
const expenseInput = z.object(expenseShape);
type ExpenseArgs = z.infer<typeof expenseInput>;

/** Turns what the assistant sent into the API's expense body (without id). */
function expenseBody(space: Space, a: ExpenseArgs) {
  const amountPaise = paise(a.amount);
  const splitType: SplitType = a.split_type ?? "equal";
  let splits: { userId: string; value: number | null }[];
  if (splitType === "equal") {
    if (a.split_values?.length && !a.split_between?.length) {
      splits = a.split_values.map((v) => ({ userId: findMember(space, v.person).id, value: null }));
    } else {
      splits = findPeople(space, a.split_between).map((m) => ({ userId: m.id, value: null }));
    }
  } else {
    if (!a.split_values?.length) throw new ToolError(`${splitType === "exact" ? "An" : "A"} ${splitType} split needs split_values: one entry per person.`);
    splits = a.split_values.map((v) => {
      const userId = findMember(space, v.person).id;
      const whose = ME_WORDS.has(norm(v.person)) ? "Your" : `${v.person}'s`;
      if (splitType === "exact") return { userId, value: paise(v.value, `${whose} share`, true) };
      if (splitType === "percent") {
        const bp = (v.value * PERCENT_TOTAL) / 100;
        if (Math.abs(bp - Math.round(bp)) > 1e-6) throw new ToolError(`${whose} percentage (${v.value}%) has more than 2 decimal places.`);
        return { userId, value: Math.round(bp) };
      }
      if (!Number.isInteger(v.value)) throw new ToolError("Shares must be whole numbers, like 1 or 2.");
      return { userId, value: v.value };
    });
  }
  if (new Set(splits.map((s) => s.userId)).size !== splits.length) throw new ToolError("Someone is listed twice in the split.");
  // Both lists given must name the same people; otherwise one would be silently ignored.
  if (a.split_between?.length && a.split_values?.length) {
    const between = new Set(findPeople(space, a.split_between).map((m) => m.id));
    const values = new Set(a.split_values.map((v) => findMember(space, v.person).id));
    if (between.size !== values.size || [...values].some((id) => !between.has(id))) {
      const names = (ids: Set<string>) => [...ids].map((id) => space.name(id)).join(", ");
      throw new ToolError(
        `split_between (${names(between)}) and split_values (${names(values)}) name different people. For an unequal split, list each person once in split_values and leave split_between out.`,
      );
    }
  }
  return {
    description: a.description,
    amountPaise,
    payerId: findMember(space, a.paid_by ?? "me").id,
    splitType,
    spentOn: toDate(a.date),
    remarks: a.notes ?? "",
    splits,
  };
}

const SPLIT_WORDS: Record<SplitType, string> = { equal: "equally", exact: "by exact amounts", percent: "by percent", shares: "by shares" };

function describeExpense(space: Space, e: Expense): string {
  // Percent and share weights are shown too, so they can be read back exactly (₹0.01 at 1%/99% rounds to ₹0/₹0.01).
  const weight = (v: number | null) =>
    v === null ? "" : e.splitType === "percent" ? ` (${(v / (PERCENT_TOTAL / 100)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%)` : e.splitType === "shares" ? ` (${v} ${v === 1 ? "share" : "shares"})` : "";
  const shares = e.shares.map((s) => `${space.name(s.userId)} ${formatMoney(s.sharePaise)}${weight(s.splitValue)}`).join(", ");
  return `${e.spentOn} · ${e.description} · ${formatMoney(e.amountPaise)} · paid by ${space.name(e.payerId)} · split ${SPLIT_WORDS[e.splitType]}: ${shares}${
    e.remarks ? ` · note: ${e.remarks}` : ""
  } · id ${e.id} (version ${e.version})`;
}

/** Your all-time standing, added after a write. The write is already saved, so a failure here only drops this line. */
async function myStanding(api: Api, space: Space): Promise<string> {
  let balances: Balances;
  try {
    balances = await api.call<Balances>("GET", `/spaces/${space.detail.id}/balances`);
  } catch {
    return "(Saved. Your balance couldn't be read just now; ask for balances to see it.)";
  }
  const net = balances.members.find((m) => m.userId === space.me.id)?.netPaise ?? 0;
  const where = `in ${space.detail.name} (all time)`;
  return net > 0 ? `You're owed ${formatMoney(net)} ${where}.` : net < 0 ? `You owe ${formatMoney(-net)} ${where}.` : `You're square ${where}.`;
}

// ── The tools ─────────────────────────────────────────────────────────────────────────────
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs a tool body; any problem becomes a readable error result instead of a protocol error. */
async function run(body: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await body() }] };
  } catch (err) {
    if (err instanceof ToolError) return { content: [{ type: "text", text: err.message }], isError: true };
    console.error("MCP tool failed", err);
    return { content: [{ type: "text", text: "Something went wrong on the server. Try again." }], isError: true };
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;

/** A query string from the values that are set. */
const query = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string | number] => e[1] !== undefined).map(([k, v]) => [k, String(v)])).toString();

/** "Showing 51–100 of 5,001; use offset 100 for more." */
const showing = (from: number, n: number, total: number) =>
  `Showing ${(from + 1).toLocaleString("en-IN")}–${(from + n).toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}${from + n < total ? `; use offset ${from + n} for more` : ""}.`;
const spaceArg = z.string().min(1).describe("The space's name (or id), from list_spaces.");
const monthArg = z.string().max(40).optional().describe("Only this month: 2026-10, October, this month or last month. Leave out for all time.");
const requestIdArg = z.uuid().optional().describe("Optional. Only for retrying this exact call: the same id with the same details is saved once.");

/**
 * The row id for a write. With a request_id it is derived from that id and the exact content,
 * so a retry of the same call is saved once, while an assistant that reuses a request_id for a
 * different expense (they make up "random" ids that repeat) still gets a new row instead of
 * silently getting the old one back.
 */
/** JSON with object keys sorted and split rows in user order, so the same request in another order matches. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    return `[${(value.every((v) => v && typeof v === "object" && "userId" in v) ? items.sort() : items).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function rowId(requestId: string | undefined, content: unknown): string {
  if (!requestId) return randomUUID();
  const h = createHash("sha256").update(requestId).update("\0").update(canonical(content)).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function buildServer(api: Api, me: Me): McpServer {
  const server = new McpServer({ name: "expense-tracker", title: "Expense Tracker", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_people",
    {
      title: "Find people on the platform",
      description: "Browse or search all registered Expense Tracker users, including yourself. Returns only display names and app IDs, never email addresses. Use these IDs or unique names as members when creating a space. Results are paginated; totals cover all matches.",
      inputSchema: {
        search: z.string().trim().max(100).optional().describe("Literal name search, or a complete app user ID."),
        limit: z.number().int().min(1).max(200).optional().describe("People per page (default 20, maximum 200)."),
        offset: z.number().int().min(0).optional().describe("Matches to skip (default 0)."),
      },
      annotations: READ,
    },
    ({ search, limit, offset }) => run(async () => {
      const params = new URLSearchParams({ limit: String(limit ?? 20), offset: String(offset ?? 0) });
      if (search) params.set("search", search);
      const page = await api.call<DirectoryPage>("GET", `/people/directory/page?${params}`);
      const scope = search ? ` matching "${search}"` : "";
      const head = `${page.total} registered ${page.total === 1 ? "person" : "people"}${scope}.`;
      if (!page.people.length) return `${head} No people on this page${page.offset ? "; try an earlier offset" : ""}.`;
      const end = page.offset + page.people.length;
      return `${head} Showing ${page.offset + 1}–${end} of ${page.total}${end < page.total ? `; use offset ${end} for more` : ""}.\n${page.people.map((p) => `- ${p.name}${p.id === me.id ? " (you)" : ""} · id ${p.id}`).join("\n")}`;
    }),
  );

  server.registerTool(
    "create_space",
    {
      title: "Create a space",
      description: "Create a monthly or one-time expense space with existing registered platform users. The signed-in user is always included as owner. Use list_people to find member names or IDs first; unknown or ambiguous members are refused before anything is created. Does not create people, send invitation emails, or configure groups. Preserve request_id and the same details on retries to avoid duplicate spaces.",
      inputSchema: {
        name: z.string().trim().min(1).max(60).describe("The new space's name."),
        kind: z.enum(["recurring", "one_time"]).optional().describe("recurring: settled month by month (default); one_time: a trip or event settled once."),
        members: z.array(z.string().trim().min(1).max(100)).max(50).optional().describe("Registered people's unique names or app IDs from list_people. You are included automatically. Omit to start a space by yourself."),
        request_id: requestIdArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ name, kind, members, request_id }) => run(async () => {
      const resolved = await Promise.all((members ?? []).map((person) => findRegisteredPerson(api, me, person)));
      const directoryIds = [...new Set(resolved.map((p) => p.id).filter((id) => id !== me.id))].sort();
      const fields = { name, kind: kind ?? "recurring", directoryIds };
      const space = await api.call<SpaceDetail>("POST", "/spaces", { id: rowId(request_id, fields), ...fields });
      return `Space ready: ${space.name} (${space.kind === "recurring" ? "monthly" : "one-time"}) · id ${space.id}\nOwner: ${me.name} (you).\nMembers: ${space.members.filter((m) => m.active).map((m) => m.id === me.id ? `${m.name} (you)` : m.name).join(", ")}\nYou can now add expenses using this space ID. Groups and shortcuts can be set up in the app.`;
    }),
  );

  server.registerTool(
    "list_spaces",
    { title: "List spaces", description: "Your spaces (flats, trips…) with how many people are in each and where you stand.", annotations: READ },
    () =>
      run(async () => {
        const spaces = await api.call<SpaceSummary[]>("GET", "/spaces");
        if (!spaces.length) return `Signed in as ${me.name}. You aren't in any space yet.`;
        const lines = spaces.map((s) => {
          const net = s.myBalancePaise;
          const standing = net > 0 ? `you're owed ${formatMoney(net)}` : net < 0 ? `you owe ${formatMoney(-net)}` : "you're square";
          const kind = s.kind === "recurring" ? "monthly" : "one-time";
          return `- ${s.name} (${kind}, ${s.memberCount} people, ${standing}) · id ${s.id}`;
        });
        return `Signed in as ${me.name} (${me.email}).\n${lines.join("\n")}`;
      }),
  );

  server.registerTool(
    "get_space",
    { title: "Show a space", description: "The people and groups in a space, and the months it has expenses for.", inputSchema: { space: spaceArg }, annotations: READ },
    ({ space }) =>
      run(async () => {
        const s = await loadSpace(api, me, space);
        const d = s.detail;
        const people = d.members.map((m) => {
          const notes = [m.role === "owner" ? "owner" : "", m.registered ? "" : "not signed up yet", m.active ? "" : "left"].filter(Boolean);
          return `- ${s.name(m.id)}${notes.length ? ` (${notes.join(", ")})` : ""}`;
        });
        const groups = s.groups.map((g) => `- ${g.name}: ${g.members.map((p) => s.name(p.id)).join(", ")}`);
        return [
          `${d.name} (${d.kind === "recurring" ? "settled month by month" : "one-time, settled once"}) · id ${d.id}`,
          `People:\n${people.join("\n")}`,
          groups.length ? `Groups:\n${groups.join("\n")}` : "No groups.",
          d.months.length ? `Months with activity: ${d.months.map(monthLabel).join(", ")}` : "No expenses yet.",
        ].join("\n\n");
      }),
  );

  server.registerTool(
    "list_expenses",
    {
      title: "List expenses",
      description:
        "Expenses in a space, newest first, with who paid, each person's share, and each expense's id and version for edit_expense. Filter by month, payer, a person who has a share, or text in the title or note; page with offset. Counts and totals cover every match, not just the page shown.",
      inputSchema: {
        space: spaceArg,
        month: monthArg,
        paid_by: z.string().optional().describe("Only expenses this person paid."),
        involving: z.string().optional().describe("Only expenses where this person has a share (whoever paid)."),
        search: z.string().max(100).optional().describe("Only expenses whose title or note contains this text."),
        limit: z.number().int().min(1).max(200).optional().describe("At most this many (default 50)."),
        offset: z.number().int().min(0).optional().describe("Skip this many matches first, to see the next page (default 0)."),
      },
      annotations: READ,
    },
    ({ space, month, paid_by, involving, search, limit, offset }) =>
      run(async () => {
        const s = await loadSpace(api, me, space);
        const m = toMonth(month);
        const where = `${s.detail.name}${m ? `, ${monthLabel(m)}` : ""}`;
        // Filters name people who may have left since: history still counts them.
        const payer = paid_by ? findMember(s, paid_by, true) : undefined;
        const involved = involving ? findMember(s, involving, true) : undefined;
        const text = search?.trim() || undefined;
        const filters = [payer && `paid by ${s.name(payer.id)}`, involved && `involving ${s.name(involved.id)}`, text && `matching "${text}"`].filter(Boolean);
        const from = offset ?? 0;
        const page = await api.call<ExpensePage>(
          "GET",
          `/spaces/${s.detail.id}/expenses/page?${query({ month: m, payer: payer?.id, involving: involved?.id, q: text, limit: limit ?? 50, offset: from })}`,
        );
        // Counts and totals come from the database and cover every match, however many there are.
        const all = filters.length ? await api.call<ExpensePage>("GET", `/spaces/${s.detail.id}/expenses/page?${query({ month: m, limit: 1 })}`) : page;
        if (!all.total) return `No expenses in ${where}.`;
        const head = `${all.total.toLocaleString("en-IN")} ${all.total === 1 ? "expense" : "expenses"} in ${where}, ${formatMoney(all.totalPaise)} in all.`;
        // With "involving", that person's own share is what's usually asked for, not the expenses' totals.
        const theirShare = involved && page.sharePaise !== null ? `, of which ${s.name(involved.id)}'s share is ${formatMoney(page.sharePaise)}` : "";
        const filtered = filters.length
          ? ` ${page.total.toLocaleString("en-IN")} ${page.total === 1 ? "is" : "are"} ${filters.join(", ")}, ${formatMoney(page.totalPaise)} in all${theirShare}.`
          : "";
        if (!page.items.length) return `${head}${filtered} Nothing ${filters.length ? "matches" : "to show"}${from ? ` after the first ${from.toLocaleString("en-IN")}` : ""}.`;
        return `${head}${filtered} ${showing(from, page.items.length, page.total)}\n${page.items.map((e) => `- ${describeExpense(s, e)}`).join("\n")}`;
      }),
  );

  server.registerTool(
    "list_payments",
    {
      title: "List payments",
      description:
        "Settle-up payments recorded in a space, newest first: who paid whom, how much, the date, the month it settles and the note. Page with offset; the count and total cover every match.",
      inputSchema: {
        space: spaceArg,
        month: z.string().max(40).optional().describe("Only payments settling this month (2026-10, October, last month). Leave out for all."),
        person: z.string().optional().describe("Only payments this person made or received, including people who have since left."),
        limit: z.number().int().min(1).max(200).optional().describe("At most this many (default 50)."),
        offset: z.number().int().min(0).optional().describe("Skip this many first, to see the next page (default 0)."),
      },
      annotations: READ,
    },
    ({ space, month, person, limit, offset }) =>
      run(async () => {
        const s = await loadSpace(api, me, space);
        const m = toMonth(month);
        const who = person ? findMember(s, person, true) : null;
        const from = offset ?? 0;
        const page = await api.call<SettlementPage>(
          "GET",
          `/spaces/${s.detail.id}/settlements/page?${query({ month: m, person: who?.id, limit: limit ?? 50, offset: from })}`,
        );
        const where = `${s.detail.name}${m ? `, settling ${monthLabel(m)}` : ""}${who ? `, involving ${s.name(who.id)}` : ""}`;
        if (!page.total) return `No payments in ${where}.`;
        const head = `${page.total.toLocaleString("en-IN")} ${page.total === 1 ? "payment" : "payments"} in ${where}, ${formatMoney(page.totalPaise)} in all.`;
        if (!page.items.length) return `${head} Nothing to show after the first ${from.toLocaleString("en-IN")}.`;
        const lines = page.items.map((p) => `- ${p.paidOn} · ${s.name(p.fromUserId)} paid ${s.name(p.toUserId)} ${formatMoney(p.amountPaise)} · for ${monthLabel(p.period)}${p.note ? ` · note: ${p.note}` : ""} · id ${p.id}`);
        return `${head} ${showing(from, page.items.length, page.total)}\n${lines.join("\n")}`;
      }),
  );

  server.registerTool(
    "get_balances",
    {
      title: "Who owes whom",
      description: "Each person's balance in a space and the payments that would settle it.",
      inputSchema: { space: spaceArg, month: monthArg },
      annotations: READ,
    },
    ({ space, month }) =>
      run(async () => {
        const s = await loadSpace(api, me, space);
        const m = toMonth(month);
        const b = await api.call<Balances>("GET", `/spaces/${s.detail.id}/balances${m ? `?month=${m}` : ""}`);
        const where = `${s.detail.name}${m ? `, ${monthLabel(m)}` : ", all time"}`;
        const lines = b.members
          .filter((x) => x.netPaise !== 0 || x.paidPaise !== 0 || x.sharePaise !== 0)
          .map((x) => {
            const net = x.netPaise > 0 ? `is owed ${formatMoney(x.netPaise)}` : x.netPaise < 0 ? `owes ${formatMoney(-x.netPaise)}` : "is square";
            return `- ${s.name(x.userId)} ${net} (paid ${formatMoney(x.paidPaise)}, share ${formatMoney(x.sharePaise)})`;
          });
        const transfers = b.transfers.map((t) => `- ${s.name(t.from)} pays ${s.name(t.to)} ${formatMoney(t.amountPaise)}`);
        if (!lines.length) return `Nothing spent in ${where}.`;
        return `Balances in ${where}:\n${lines.join("\n")}\n\n${transfers.length ? `To settle up:\n${transfers.join("\n")}` : "Everyone is square."}`;
      }),
  );

  server.registerTool(
    "add_expense",
    {
      title: "Add an expense",
      description:
        'Adds one expense to a space. By default you paid and it is split equally between everyone in the space. Use split_between for some people or a group, or split_type with split_values for unequal splits.',
      inputSchema: { space: spaceArg, ...expenseShape, request_id: requestIdArg },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ space, request_id, ...args }) =>
      run(async () => {
        const s = await loadSpace(api, me, space);
        const fields = expenseBody(s, args);
        const body = { id: rowId(request_id, { space: s.detail.id, ...fields }), ...fields };
        const e = await api.call<Expense>("POST", `/spaces/${s.detail.id}/expenses`, body);
        return `Added to ${s.detail.name}: ${describeExpense(s, e)}\n${await myStanding(api, s)}`;
      }),
  );

  server.registerTool(
    "add_expenses",
    {
      title: "Add several expenses",
      description: "Adds up to 50 expenses to one space at once. All are saved, or none if any has a problem.",
      inputSchema: { space: spaceArg, expenses: z.array(expenseInput.extend({ request_id: requestIdArg })).min(1).max(50) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ space, expenses }) =>
      run(async () => {
        const s = await loadSpace(api, me, space);
        const rows = expenses.map(({ request_id, ...args }, i) => {
          try {
            const fields = expenseBody(s, args);
            return { id: rowId(request_id, { space: s.detail.id, ...fields }), ...fields };
          } catch (err) {
            throw err instanceof ToolError ? new ToolError(`Expense ${i + 1}: ${err.message}`) : err;
          }
        });
        const saved = await api.call<{ expenses: Expense[] }>("POST", `/spaces/${s.detail.id}/expenses/bulk`, { expenses: rows });
        const total = saved.expenses.reduce((sum, e) => sum + e.amountPaise, 0);
        return `Added ${saved.expenses.length} ${saved.expenses.length === 1 ? "expense" : "expenses"} (${formatMoney(total)}) to ${s.detail.name}:\n${saved.expenses.map((e) => `- ${describeExpense(s, e)}`).join("\n")}\n${await myStanding(api, s)}`;
      }),
  );

  server.registerTool(
    "edit_expense",
    {
      title: "Edit an expense",
      description:
        "Changes an expense. Send only what changes; the rest stays, including the split type and its percentages or shares when only the amount changes. Get the id and version from list_expenses.",
      inputSchema: {
        expense_id: z.uuid().describe("The expense's id, from list_expenses."),
        version: z.number().int().positive().describe("The version you saw in list_expenses. If someone changed it since, the edit is refused so nothing is overwritten."),
        ...expenseInput.partial().shape,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ expense_id, version, ...changes }) =>
      run(async () => {
        if (Object.values(changes).every((v) => v === undefined)) return "Nothing to change: no fields were given, so the expense was left as it is.";
        const current = await api.call<Expense>("GET", `/expenses/${expense_id}`);
        if (version !== current.version) {
          throw new ToolError(`Someone changed this expense since (now version ${current.version}). Look at it again first.`);
        }
        const s = await loadSpace(api, me, current.spaceId);
        // New values without a type keep the current type (a 60/40 percent split edited to 70/30 stays percent).
        if (changes.split_values !== undefined && changes.split_type === undefined && changes.split_between === undefined && current.splitType !== "equal") {
          changes.split_type = current.splitType;
        }
        const resplit = changes.split_type !== undefined || changes.split_between !== undefined || changes.split_values !== undefined;
        const built = expenseBody(s, {
          description: changes.description ?? current.description,
          amount: changes.amount ?? current.amountPaise / 100,
          paid_by: changes.paid_by ?? current.payerId,
          date: changes.date ?? current.spentOn,
          notes: changes.notes ?? current.remarks,
          // Keep the old split unless any part of it is given.
          ...(resplit ? { split_type: changes.split_type, split_between: changes.split_between, split_values: changes.split_values } : { split_between: current.shares.map((x) => x.userId) }),
        });
        const body = resplit || current.splitType === "equal"
          ? built
          : { ...built, splitType: current.splitType, splits: current.shares.map((x) => ({ userId: x.userId, value: x.splitValue })) };
        const e = await api.call<Expense>("PATCH", `/expenses/${expense_id}`, { version, ...body });
        return `Updated: ${describeExpense(s, e)}\n${await myStanding(api, s)}`;
      }),
  );

  server.registerTool(
    "record_payment",
    {
      title: "Record a payment",
      description: "Records money one person paid another to settle up, e.g. Bala paid you ₹500.",
      inputSchema: {
        space: spaceArg,
        from: z.string().optional().describe('Who paid. Defaults to "me".'),
        to: z.string().min(1).describe("Who received it."),
        amount: z.number().positive().describe("Rupees."),
        date: z.string().max(40).optional().describe("When it was paid. Defaults to today."),
        month: z.string().max(40).optional().describe("For monthly spaces: the month it settles (2026-10, October). Defaults to the month it was paid."),
        note: z.string().max(200).optional(),
        request_id: requestIdArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ space, from, to, amount, date, month, note, request_id }) =>
      run(async () => {
        const s = await loadSpace(api, me, space);
        const payer = findMember(s, from ?? "me");
        const payee = findMember(s, to);
        const fields = { fromUserId: payer.id, toUserId: payee.id, amountPaise: paise(amount), paidOn: toDate(date), period: toMonth(month), note: note ?? "" };
        const p = await api.call<Settlement>("POST", `/spaces/${s.detail.id}/settlements`, {
          id: rowId(request_id, { space: s.detail.id, ...fields }),
          ...fields,
        });
        return `Recorded: ${s.name(p.fromUserId)} paid ${s.name(p.toUserId)} ${formatMoney(p.amountPaise)} on ${p.paidOn} (for ${monthLabel(p.period)}) in ${s.detail.name}. id ${p.id}\n${await myStanding(api, s)}`;
      }),
  );

  return server;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────
const rpcError = (c: Context, status: 401 | 405, message: string) =>
  c.json({ jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32000, message }, id: null }, status);

/** The MCP endpoint at /mcp and /mcp/<key>, backed by the API app's fetch. */
export function createMcpApp(api: { fetch: FetchApi }) {
  const app = new Hono();

  // Browser-based MCP clients (e.g. the MCP Inspector) need CORS. No cookies are involved:
  // the key travels in the header or the address.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["POST", "GET", "DELETE", "OPTIONS"],
      allowHeaders: ["authorization", "content-type", "accept", "mcp-protocol-version", "mcp-session-id", "last-event-id"],
      exposeHeaders: ["mcp-session-id"],
    }),
  );
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use("*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ jsonrpc: "2.0", error: { code: -32600, message: "Request is too large." }, id: null }, 413) }));

  const handle = async (c: Context) => {
    const header = c.req.header("authorization") ?? "";
    const key = (header.startsWith("Bearer ") ? header.slice(7).trim() : "") || (c.req.param("key") ?? "");
    if (!key.startsWith(TOKEN_PREFIX)) {
      return rpcError(c, 401, "Add your personal key: create one in the app under Settings → iPhone & AI apps, then use the connector address it shows.");
    }
    const client = new Api(api.fetch, key);
    let me: Me;
    try {
      me = await client.call<Me>("GET", "/me");
    } catch (err) {
      return rpcError(c, 401, err instanceof ToolError ? err.message : "Could not check the key.");
    }
    // Stateless: a fresh server and transport per request, answering with plain JSON.
    const server = buildServer(client, me);
    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c);
  };

  // Stateless servers have no stream to open (GET) or session to end (DELETE).
  const notAllowed = (c: Context) => {
    c.header("Allow", "POST, OPTIONS");
    return rpcError(c, 405, "Use POST.");
  };

  for (const path of ["/mcp", "/mcp/:key{et_[A-Za-z0-9_-]+}"]) {
    app.post(path, handle);
    app.on(["GET", "DELETE"], path, notAllowed);
  }
  app.notFound((c) => c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Not found. The address is /mcp or /mcp/<your key>." }, id: null }, 404));
  return app;
}
