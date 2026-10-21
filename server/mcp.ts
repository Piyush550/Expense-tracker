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
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Balances, Expense, Group, Me, Member, Settlement, SpaceDetail, SpaceSummary } from "../shared/api";
import { MONTH_RE, monthLabel, shiftMonth } from "../shared/dates";
import { formatMoney, MAX_AMOUNT_PAISE } from "../shared/money";
import { PERCENT_TOTAL, type SplitType } from "../shared/split";
import { quickDate, todayInIndia } from "./quick";
import { TOKEN_PREFIX } from "./tokens";

type FetchApi = (req: Request) => Response | Promise<Response>;

const VERSION = "1.0.0";
const INSTRUCTIONS = `Expense Tracker: shared expenses in "spaces" (a flat, a trip), split between people.
Amounts are in rupees (₹). People and spaces are named by name; "me" means the signed-in user.
Start with list_spaces. Before adding, check names with get_space if unsure. Never guess an amount or who paid: ask.
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
  if (!spaces.length) throw new ToolError("You aren't in any space yet. Create one in the app first.");
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

/** A member by name, email, id, or "me". By name only current members; by id anyone. */
function findMember(space: Space, wanted: string): Member {
  const w = norm(wanted);
  const byId = space.detail.members.find((m) => m.id === wanted.trim());
  if (byId) return byId;
  const members = space.detail.members.filter((m) => m.active);
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

/** People for an equal split: names, group names or "everyone". Empty means everyone. */
function findPeople(space: Space, wanted: string[] | undefined): Member[] {
  const active = space.detail.members.filter((m) => m.active);
  const out = new Map<string, Member>();
  for (const raw of wanted ?? []) {
    const w = norm(raw);
    if (!w) continue;
    if (EVERYONE_WORDS.has(w)) {
      active.forEach((m) => out.set(m.id, m));
      continue;
    }
    const group = space.groups.find((g) => norm(g.name) === w);
    let person: Member | null = null;
    try {
      person = findMember(space, raw);
    } catch (err) {
      if (!group) throw err;
    }
    if (person) out.set(person.id, person);
    else group!.members.forEach((p) => {
      const m = active.find((a) => a.id === p.id);
      if (m) out.set(m.id, m);
    });
  }
  return out.size ? [...out.values()] : active;
}

// ── Money, dates, months ──────────────────────────────────────────────────────────────────
function paise(rupees: number, what = "The amount"): number {
  const p = Math.round(rupees * 100);
  if (!Number.isFinite(p) || p <= 0) throw new ToolError(`${what} must be above zero.`);
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
  value: z.number().min(0).describe("exact: rupees this person owes · percent: their percent (all add up to 100) · shares: how many shares (e.g. 2 for a couple)"),
});

const expenseShape = {
  description: z.string().trim().min(1).max(100).describe("What it was for, e.g. Groceries."),
  amount: z.number().positive().describe("Total in rupees, e.g. 450 or 450.50."),
  paid_by: z.string().optional().describe('Who paid: a name in the space. Defaults to "me".'),
  split_between: z
    .array(z.string())
    .max(100)
    .optional()
    .describe('For an equal split: names, group names or "everyone". Defaults to everyone in the space.'),
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
      if (splitType === "exact") return { userId, value: Math.round(v.value * 100) };
      if (splitType === "percent") return { userId, value: Math.round((v.value * PERCENT_TOTAL) / 100) };
      if (!Number.isInteger(v.value)) throw new ToolError("Shares must be whole numbers, like 1 or 2.");
      return { userId, value: v.value };
    });
  }
  if (new Set(splits.map((s) => s.userId)).size !== splits.length) throw new ToolError("Someone is listed twice in the split.");
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
  const shares = e.shares.map((s) => `${space.name(s.userId)} ${formatMoney(s.sharePaise)}`).join(", ");
  return `${e.spentOn} · ${e.description} · ${formatMoney(e.amountPaise)} · paid by ${space.name(e.payerId)} · split ${SPLIT_WORDS[e.splitType]}: ${shares}${
    e.remarks ? ` · note: ${e.remarks}` : ""
  } · id ${e.id} (version ${e.version})`;
}

async function myStanding(api: Api, space: Space): Promise<string> {
  const balances = await api.call<Balances>("GET", `/spaces/${space.detail.id}/balances`);
  const net = balances.members.find((m) => m.userId === space.me.id)?.netPaise ?? 0;
  return net > 0 ? `You're owed ${formatMoney(net)} in ${space.detail.name}.` : net < 0 ? `You owe ${formatMoney(-net)} in ${space.detail.name}.` : `You're square in ${space.detail.name}.`;
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
const spaceArg = z.string().min(1).describe("The space's name (or id), from list_spaces.");
const monthArg = z.string().max(40).optional().describe("Only this month: 2026-10, October, this month or last month. Leave out for all time.");
const requestIdArg = z.uuid().optional().describe("Optional. Send the same id again when retrying, so nothing is added twice.");

function buildServer(api: Api, me: Me): McpServer {
  const server = new McpServer({ name: "expense-tracker", title: "Expense Tracker", version: VERSION }, { instructions: INSTRUCTIONS });

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
      description: "Expenses in a space, newest first, with who paid and each person's share. Includes each expense's id for edit_expense.",
      inputSchema: { space: spaceArg, month: monthArg, limit: z.number().int().min(1).max(200).optional().describe("At most this many (default 50).") },
      annotations: READ,
    },
    ({ space, month, limit }) =>
      run(async () => {
        const s = await loadSpace(api, me, space);
        const m = toMonth(month);
        const all = await api.call<Expense[]>("GET", `/spaces/${s.detail.id}/expenses${m ? `?month=${m}` : ""}`);
        const shown = all.slice(0, limit ?? 50);
        const where = `${s.detail.name}${m ? `, ${monthLabel(m)}` : ""}`;
        if (!all.length) return `No expenses in ${where}.`;
        const total = all.reduce((sum, e) => sum + e.amountPaise, 0);
        const more = all.length > shown.length ? ` Showing the newest ${shown.length}; ask for a month or a higher limit to see others.` : "";
        return `${all.length} ${all.length === 1 ? "expense" : "expenses"} in ${where}, ${formatMoney(total)} in all.${more}\n${shown.map((e) => `- ${describeExpense(s, e)}`).join("\n")}`;
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
        const body = { id: request_id ?? randomUUID(), ...expenseBody(s, args) };
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
            return { id: request_id ?? randomUUID(), ...expenseBody(s, args) };
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
      description: "Changes an expense. Send only what changes; the rest stays. Get the id from list_expenses.",
      inputSchema: {
        expense_id: z.uuid().describe("The expense's id, from list_expenses."),
        version: z.number().int().positive().optional().describe("The version you saw. If someone changed it since, the edit is refused."),
        ...expenseInput.partial().shape,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ expense_id, version, ...changes }) =>
      run(async () => {
        const current = await api.call<Expense>("GET", `/expenses/${expense_id}`);
        if (version !== undefined && version !== current.version) {
          throw new ToolError(`Someone changed this expense since (now version ${current.version}). Look at it again first.`);
        }
        const s = await loadSpace(api, me, current.spaceId);
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
        const e = await api.call<Expense>("PATCH", `/expenses/${expense_id}`, { version: current.version, ...body });
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
        const p = await api.call<Settlement>("POST", `/spaces/${s.detail.id}/settlements`, {
          id: request_id ?? randomUUID(),
          fromUserId: payer.id,
          toUserId: payee.id,
          amountPaise: paise(amount),
          paidOn: toDate(date),
          period: toMonth(month),
          note: note ?? "",
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
