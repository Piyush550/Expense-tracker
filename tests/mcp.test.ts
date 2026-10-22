import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Balances, Expense, Me, NewApiToken, Settlement, SpaceDetail } from "../shared/api";
import { createMcpApp } from "../server/mcp";
import { todayInIndia } from "../server/quick";
import { newId, person, setup } from "./helpers";

type Api = Awaited<ReturnType<typeof setup>>;
const asha = person("asha");
const bala = person("bala");
const chen = person("chen");
let api: Api;
let mcp: ReturnType<typeof createMcpApp>;

beforeEach(async () => {
  api = await setup();
  mcp = createMcpApp(api.app);
});

async function makeKey(as = asha) {
  return (await api.call<NewApiToken>(as, "POST", "/tokens", { name: "Claude", lifetimeDays: 365 })).body.token;
}

async function flat() {
  const space = await api.call<SpaceDetail>(asha, "POST", "/spaces", { name: "Flat 4B", memberEmails: [bala.email, chen.email] });
  const ashaId = (await api.call<Me>(asha, "GET", "/me")).body.id;
  const balaId = space.body.members.find((m) => m.email === bala.email)!.id;
  const chenId = space.body.members.find((m) => m.email === chen.email)!.id;
  return { space: space.body, ashaId, balaId, chenId };
}

/** A real MCP client talking to the app, with the key in the address or the header. */
async function connect(key: string, via: "url" | "header" = "url") {
  const url = new URL(via === "url" ? `http://localhost/mcp/${key}` : "http://localhost/mcp");
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: async (input, init) => mcp.request(String(input), init),
    requestInit: via === "header" ? { headers: { authorization: `Bearer ${key}` } } : undefined,
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  return { text: res.content.map((c) => c.text).join("\n"), isError: res.isError ?? false };
}

async function rpc(path: string, headers: Record<string, string> = {}, method = "POST") {
  const res = await mcp.request(path, {
    method,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: method === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) : undefined,
  });
  return { status: res.status, body: (await res.json()) as { error?: { message: string }; result?: { tools: { name: string }[] } } };
}

describe("MCP server", () => {
  it("signs in with a key in the address or the header, and lists the tools without delete ones", async () => {
    const key = await makeKey();
    for (const via of ["url", "header"] as const) {
      const client = await connect(key, via);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        ["add_expense", "add_expenses", "create_space", "edit_expense", "get_balances", "get_space", "list_expenses", "list_payments", "list_people", "list_spaces", "record_payment"].sort(),
      );
      expect(tools.find((t) => t.name === "list_spaces")?.annotations?.readOnlyHint).toBe(true);
      await client.close();
    }
  });

  it("refuses a missing, wrong or revoked key, and a normal sign-in token", async () => {
    expect((await rpc("/mcp")).status).toBe(401);
    expect((await rpc("/mcp", { authorization: "Bearer not-a-key" })).status).toBe(401);
    const wrong = await rpc("/mcp/et_wrongwrongwrong");
    expect(wrong.status).toBe(401);
    expect(wrong.body.error?.message).toMatch(/not valid any more/);

    const key = await makeKey();
    expect((await rpc(`/mcp/${key}`)).status).toBe(200);
    const id = (await api.call<{ id: string }[]>(asha, "GET", "/tokens")).body[0]!.id;
    await api.call(asha, "POST", `/tokens/${id}/revoke`);
    expect((await rpc(`/mcp/${key}`)).status).toBe(401);

    expect((await rpc("/mcp", { authorization: `Bearer ${encodeURIComponent(JSON.stringify(asha))}` })).status).toBe(401);
    expect((await rpc(`/mcp/${key}`, {}, "GET")).status).toBe(405);
    expect((await rpc("/mcp/somethingelse")).status).toBe(404);
  });

  it("reads spaces, people, expenses and balances by name", async () => {
    const { space, ashaId, balaId } = await flat();
    await api.call(asha, "POST", `/spaces/${space.id}/expenses`, {
      id: newId(), description: "Rent", amountPaise: 3_000_000, payerId: ashaId, splitType: "equal", spentOn: "2026-10-01",
      splits: space.members.map((m) => ({ userId: m.id })),
    });
    await api.call(asha, "POST", `/spaces/${space.id}/settlements`, { id: newId(), fromUserId: balaId, toUserId: ashaId, amountPaise: 500_000, paidOn: "2026-10-05" });
    const client = await connect(await makeKey());

    const spaces = await tool(client, "list_spaces");
    expect(spaces.text).toContain("Signed in as asha");
    expect(spaces.text).toMatch(/Flat 4B \(monthly, 3 people, you're owed ₹15,000\)/);

    const detail = await tool(client, "get_space", { space: "flat" });
    expect(detail.text).toContain("asha (you) (owner)");
    expect(detail.text).toContain("bala");

    const list = await tool(client, "list_expenses", { space: "Flat 4B", month: "2026-10" });
    expect(list.text).toMatch(/1 expense in Flat 4B, October 2026, ₹30,000 in all/);
    expect(list.text).toContain("paid by asha (you)");

    for (const month of ["Octember", "octopus", "oc"]) {
      const bad = await tool(client, "list_expenses", { space: "Flat 4B", month });
      expect(bad, month).toMatchObject({ isError: true });
      expect(bad.text).toContain("Could not read the month");
    }
    expect((await tool(client, "list_expenses", { space: "Flat 4B", month: "Oct 2026" })).text).toMatch(/^1 expense in Flat 4B, October 2026/);

    const balances = await tool(client, "get_balances", { space: "Flat 4B" });
    expect(balances.text).toContain("asha (you) is owed ₹15,000");
    expect(balances.text).toContain("chen pays asha (you) ₹10,000");

    const missing = await tool(client, "get_space", { space: "Goa trip" });
    expect(missing).toMatchObject({ isError: true });
    expect(missing.text).toContain('Choose from: "Flat 4B"');
  });

  it("adds expenses with names, groups and unequal splits, and is safe to retry", async () => {
    const { space, ashaId, balaId, chenId } = await flat();
    const group = await api.call<{ id: string }>(asha, "POST", `/spaces/${space.id}/groups`, { name: "Boys", memberIds: [balaId, chenId] });
    expect(group.status).toBe(201);
    const client = await connect(await makeKey());

    const requestId = newId();
    const added = await tool(client, "add_expense", { space: "Flat 4B", description: "Dinner", amount: 900, split_between: ["me", "Bala"], request_id: requestId });
    expect(added.isError).toBe(false);
    expect(added.text).toMatch(/₹900 · paid by asha \(you\) · split equally: (asha \(you\) ₹450, bala ₹450|bala ₹450, asha \(you\) ₹450)/);
    expect(added.text).toContain("You're owed ₹450 in Flat 4B (all time).");
    await tool(client, "add_expense", { space: "Flat 4B", description: "Dinner", amount: 900, split_between: ["me", "Bala"], request_id: requestId });

    // Assistants reuse made-up request ids: the same id with different details is a new expense.
    await tool(client, "add_expense", { space: "Flat 4B", description: "Lunch", amount: 300, request_id: requestId });
    const sameId = (await api.call<Expense[]>(asha, "GET", `/spaces/${space.id}/expenses`)).body;
    expect(sameId.map((e) => e.description).sort()).toEqual(["Dinner", "Lunch"]);

    const byGroup = await tool(client, "add_expense", { space: "Flat 4B", description: "Beer", amount: 600, paid_by: "chen", split_between: ["Boys"], date: "yesterday" });
    expect(byGroup.isError).toBe(false);

    const percent = await tool(client, "add_expense", {
      space: "Flat 4B", description: "Cab", amount: 1000, split_type: "percent",
      split_values: [{ person: "me", value: 60 }, { person: "chen", value: 40 }],
    });
    expect(percent.text).toContain("split by percent");

    const expenses = (await api.call<Expense[]>(asha, "GET", `/spaces/${space.id}/expenses`)).body;
    expect(expenses).toHaveLength(4);
    const beer = expenses.find((e) => e.description === "Beer")!;
    expect(beer.payerId).toBe(chenId);
    expect(beer.shares.map((s) => s.userId).sort()).toEqual([balaId, chenId].sort());
    const cab = expenses.find((e) => e.description === "Cab")!;
    expect(cab.shares.find((s) => s.userId === ashaId)?.sharePaise).toBe(60_000);
    expect(todayInIndia() > beer.spentOn).toBe(true);

    const ambiguous = await tool(client, "add_expense", { space: "Flat 4B", description: "Tea", amount: 50, split_between: ["a"] });
    expect(ambiguous).toMatchObject({ isError: true });
    expect(ambiguous.text).toMatch(/could be "asha" or "bala"/);
    const noValues = await tool(client, "add_expense", { space: "Flat 4B", description: "Tea", amount: 50, split_type: "exact" });
    expect(noValues.text).toBe("An exact split needs split_values: one entry per person.");

    const bad = await tool(client, "add_expense", { space: "Flat 4B", description: "Tea", amount: 50, split_between: ["Zed"] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/No person called "Zed" in Flat 4B/);
  });

  it("adds several at once, all or nothing", async () => {
    const { space } = await flat();
    const client = await connect(await makeKey());
    const failed = await tool(client, "add_expenses", {
      space: "Flat 4B",
      expenses: [{ description: "Milk", amount: 60 }, { description: "Eggs", amount: 90, paid_by: "nobody" }],
    });
    expect(failed).toMatchObject({ isError: true });
    expect(failed.text).toContain("Expense 2:");
    expect((await api.call<Expense[]>(asha, "GET", `/spaces/${space.id}/expenses`)).body).toHaveLength(0);

    const ok = await tool(client, "add_expenses", { space: "Flat 4B", expenses: [{ description: "Milk", amount: 60 }, { description: "Eggs", amount: 90 }] });
    expect(ok.text).toContain("Added 2 expenses (₹150)");
  });

  it("edits an expense keeping what wasn't sent, and records payments", async () => {
    const { space, ashaId, balaId } = await flat();
    const client = await connect(await makeKey());
    await tool(client, "add_expense", { space: "Flat 4B", description: "Gas", amount: 300, split_type: "exact", split_values: [{ person: "me", value: 100 }, { person: "bala", value: 200 }] });
    const gas = (await api.call<Expense[]>(asha, "GET", `/spaces/${space.id}/expenses`)).body[0]!;

    const renamed = await tool(client, "edit_expense", { expense_id: gas.id, description: "Gas cylinder", version: gas.version });
    expect(renamed.isError).toBe(false);
    const after = (await api.call<Expense>(asha, "GET", `/expenses/${gas.id}`)).body;
    expect(after).toMatchObject({ description: "Gas cylinder", splitType: "exact", amountPaise: 30_000, version: 2 });
    expect(after.shares.find((s) => s.userId === balaId)?.sharePaise).toBe(20_000);

    const stale = await tool(client, "edit_expense", { expense_id: gas.id, amount: 400, version: 1 });
    expect(stale).toMatchObject({ isError: true });
    expect(stale.text).toContain("now version 2");

    const resplit = await tool(client, "edit_expense", { expense_id: gas.id, version: 2, amount: 400, split_type: "equal", split_between: ["everyone"] });
    expect(resplit.text).toContain("split equally");

    const paid = await tool(client, "record_payment", { space: "Flat 4B", from: "bala", to: "me", amount: 250, month: "October 2026" });
    expect(paid.isError).toBe(false);
    expect(paid.text).toContain("bala paid asha (you) ₹250");
    const payments = (await api.call<Settlement[]>(asha, "GET", `/spaces/${space.id}/settlements`)).body;
    expect(payments[0]).toMatchObject({ fromUserId: balaId, toUserId: ashaId, amountPaise: 25_000, period: "2026-10" });
    const self = await tool(client, "record_payment", { space: "Flat 4B", to: "me", amount: 10 });
    expect(self).toEqual({ isError: true, text: "Someone cannot pay themselves." });
    const balances = (await api.call<Balances>(asha, "GET", `/spaces/${space.id}/balances`)).body;
    expect(balances.members.reduce((sum, m) => sum + m.netPaise, 0)).toBe(0);
  });

  it("only sees the key owner's spaces", async () => {
    await flat();
    const client = await connect(await makeKey(person("dev")));
    expect((await tool(client, "list_spaces")).text).toContain("aren't in any space");
    expect(await tool(client, "list_expenses", { space: "Flat 4B" })).toMatchObject({ isError: true });
  });
});

// Regressions for the failures found by the acceptance audit in docs/MCP_TEST_PROMPTS.md (K01–K10).
describe("MCP server: acceptance-audit regressions", () => {
  const all = async (spaceId: string) => (await api.call<Expense[]>(asha, "GET", `/spaces/${spaceId}/expenses`)).body;
  const group = async (spaceId: string, name: string, memberIds: string[]) =>
    expect((await api.call(asha, "POST", `/spaces/${spaceId}/groups`, { name, memberIds })).status).toBe(201);

  it("refuses money with more than 2 decimals instead of rounding it (K06)", async () => {
    const { space } = await flat();
    const client = await connect(await makeKey());
    const amount = await tool(client, "add_expense", { space: "Flat 4B", description: "Gum", amount: 1.005 });
    expect(amount).toMatchObject({ isError: true });
    expect(amount.text).toContain("more than 2 decimal places");
    const exact = await tool(client, "add_expense", { space: "Flat 4B", description: "Gum", amount: 1, split_type: "exact", split_values: [{ person: "me", value: 0.504 }, { person: "bala", value: 0.496 }] });
    expect(exact.text).toContain("more than 2 decimal places");
    const pct = await tool(client, "add_expense", { space: "Flat 4B", description: "Gum", amount: 3, split_type: "percent", split_values: [{ person: "me", value: 33.333 }, { person: "bala", value: 66.667 }] });
    expect(pct.text).toContain("more than 2 decimal places");
    expect(await all(space.id)).toHaveLength(0);
    expect((await tool(client, "add_expense", { space: "Flat 4B", description: "Gum", amount: 1.01, split_between: ["me", "bala"] })).isError).toBe(false);
    expect((await all(space.id))[0]!.amountPaise).toBe(101);
  });

  it("treats a retry with the people in another order as the same request (K04)", async () => {
    const { space } = await flat();
    const client = await connect(await makeKey());
    const base = { space: "Flat 4B", description: "Tea", amount: 80, date: "2026-10-21", request_id: newId() };
    await tool(client, "add_expense", { ...base, split_between: ["me", "bala"] });
    await tool(client, "add_expense", { ...base, split_between: ["bala", "me"] });
    expect(await all(space.id)).toHaveLength(1);
    await tool(client, "add_expense", { ...base, split_between: ["bala", "chen"] });
    expect(await all(space.id)).toHaveLength(2);
  });

  it("edits: keeps the split type for new values, requires the version, and skips empty edits (K01, K07, E14)", async () => {
    const { space, ashaId, chenId } = await flat();
    const client = await connect(await makeKey());
    await tool(client, "add_expense", { space: "Flat 4B", description: "Cab", amount: 100, split_type: "percent", split_values: [{ person: "me", value: 60 }, { person: "chen", value: 40 }] });
    const cab = (await all(space.id))[0]!;
    const r = await tool(client, "edit_expense", { expense_id: cab.id, version: 1, split_values: [{ person: "me", value: 70 }, { person: "chen", value: 30 }] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/asha \(you\) ₹70 \(70%\)/);
    const after = (await all(space.id))[0]!;
    expect(after.splitType).toBe("percent");
    expect(after.shares.find((s) => s.userId === ashaId)?.sharePaise).toBe(7000);
    expect(after.shares.find((s) => s.userId === chenId)?.sharePaise).toBe(3000);

    const noVersion = await tool(client, "edit_expense", { expense_id: cab.id, description: "Taxi" });
    expect(noVersion.isError).toBe(true);
    expect((await all(space.id))[0]!.description).toBe("Cab");

    const empty = await tool(client, "edit_expense", { expense_id: cab.id, version: 2 });
    expect(empty.text).toContain("Nothing to change");
    expect((await all(space.id))[0]!.version).toBe(2);
  });

  it("refuses empty or unusable splits instead of widening them to everyone (K02)", async () => {
    const { space, balaId, chenId } = await flat();
    await group(space.id, "Gone", [balaId, chenId]);
    await api.call(asha, "DELETE", `/spaces/${space.id}/members/${balaId}`);
    await api.call(asha, "DELETE", `/spaces/${space.id}/members/${chenId}`);
    const client = await connect(await makeKey());
    const empty = await tool(client, "add_expense", { space: "Flat 4B", description: "Tea", amount: 100, split_between: [] });
    expect(empty.text).toContain("No one was picked");
    const gone = await tool(client, "add_expense", { space: "Flat 4B", description: "Tea", amount: 100, split_between: ["Gone"] });
    expect(gone.text).toContain('"Gone" has no current members');
    expect(await all(space.id)).toHaveLength(0);
  });

  it("asks instead of guessing when a name means two different sets of people (K03)", async () => {
    const { space, ashaId, balaId, chenId } = await flat();
    await group(space.id, "bala", [ashaId, chenId]);
    await group(space.id, "Everyone", [balaId, chenId]);
    await group(space.id, "Pair", [ashaId, balaId]);
    await group(space.id, "Pair", [balaId, chenId]);
    const client = await connect(await makeKey());
    const add = (split_between: string[], description = "Tea") => tool(client, "add_expense", { space: "Flat 4B", description, amount: 100, split_between });

    expect((await add(["bala"])).text).toMatch(/both the person bala and the group "bala"/);
    expect((await add(["Everyone"])).text).toMatch(/could mean everyone in Flat 4B or the group "Everyone"/);
    expect((await add(["Pair"])).text).toMatch(/There are 2 groups called "Pair"/);
    expect(await all(space.id)).toHaveLength(0);

    await add(["group:bala"], "Group bala");
    await add(["person:bala"], "Person bala");
    await add(["group:Everyone"], "Group everyone");
    const saved = await all(space.id);
    const people = (d: string) => saved.find((e) => e.description === d)!.shares.map((s) => s.userId).sort();
    expect(people("Group bala")).toEqual([ashaId, chenId].sort());
    expect(people("Person bala")).toEqual([balaId]);
    expect(people("Group everyone")).toEqual([balaId, chenId].sort());
  });

  it("reports a saved write as saved even if reading the balance afterwards fails (K05)", async () => {
    const { space } = await flat();
    const key = await makeKey();
    const failing = createMcpApp({
      fetch: (req: Request) =>
        new URL(req.url).pathname.endsWith("/balances") ? new Response(JSON.stringify({ error: { code: "x", message: "down" } }), { status: 503 }) : api.app.fetch(req),
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost/mcp/${key}`), { fetch: async (u, init) => failing.request(String(u), init) }));
    const r = await tool(client, "add_expense", { space: "Flat 4B", description: "Tea", amount: 100 });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/^Added to Flat 4B: .*\n\(Saved\. Your balance couldn't be read/s);
    expect(await all(space.id)).toHaveLength(1);
  });

  it("filters and pages expenses, and counts every row past 5,000 (K08, K09, K11)", async () => {
    const { space, ashaId, chenId } = await flat();
    const client = await connect(await makeKey());
    await tool(client, "add_expenses", {
      space: "Flat 4B",
      expenses: [
        { description: "Taxi", amount: 600, paid_by: "chen", split_between: ["bala", "chen"], date: "2026-10-05" },
        { description: "Power", amount: 900, notes: "electricity bill", split_between: ["me", "chen"], date: "2026-10-08" },
        { description: "Snacks", amount: 300, split_between: ["me"], date: "2026-10-09" },
      ],
    });
    expect((await tool(client, "list_expenses", { space: "Flat 4B", paid_by: "chen" })).text).toMatch(/1 is paid by chen, ₹600 in all\./);
    const involving = await tool(client, "list_expenses", { space: "Flat 4B", involving: "chen" });
    expect(involving.text).toMatch(/2 are involving chen, ₹1,500 in all, of which chen's share is ₹750\./);
    expect((await tool(client, "list_expenses", { space: "Flat 4B", search: "ELECTRICITY" })).text).toMatch(/1 is matching "ELECTRICITY", ₹900 in all\.[\s\S]*Power/);
    const page = await tool(client, "list_expenses", { space: "Flat 4B", limit: 2 });
    expect(page.text).toMatch(/Showing 1–2 of 3; use offset 2 for more\./);
    expect((await tool(client, "list_expenses", { space: "Flat 4B", limit: 2, offset: 2 })).text).toMatch(/Showing 3–3 of 3\.\n- 2026-10-05 · Taxi/);

    await api.db.query(
      `INSERT INTO expenses (id, space_id, description, amount_paise, payer_id, split_type, spent_on, created_by, updated_by)
       SELECT gen_random_uuid(), $1, 'Vol ' || g, 100, $2, 'equal', '2026-09-15', $2, $2 FROM generate_series(1, 5001) g`,
      [space.id, ashaId],
    );
    await api.db.query(`INSERT INTO expense_shares (expense_id, user_id, share_paise) SELECT id, $2, 100 FROM expenses WHERE space_id = $1 AND description LIKE 'Vol %'`, [space.id, chenId]);
    expect((await tool(client, "list_expenses", { space: "Flat 4B", month: "2026-09", limit: 1 })).text).toMatch(/^5,001 expenses in Flat 4B, September 2026, ₹5,001 in all\./);
    expect((await tool(client, "list_expenses", { space: "Flat 4B", limit: 1 })).text).toMatch(/^5,004 expenses in Flat 4B, ₹6,801 in all\./);
  });

  it("lists payments with dates, months and notes (K10)", async () => {
    const { space, ashaId, balaId, chenId } = await flat();
    await api.call(asha, "POST", `/spaces/${space.id}/settlements`, { id: newId(), fromUserId: balaId, toUserId: ashaId, amountPaise: 20000, paidOn: "2026-11-03", period: "2026-10", note: "UPI" });
    await api.call(asha, "POST", `/spaces/${space.id}/settlements`, { id: newId(), fromUserId: chenId, toUserId: ashaId, amountPaise: 5000, paidOn: "2026-09-30" });
    const client = await connect(await makeKey());
    const r = await tool(client, "list_payments", { space: "Flat 4B" });
    expect(r.text).toMatch(/^2 payments in Flat 4B, ₹250 in all\. Showing 1–2 of 2\.\n- 2026-11-03 · bala paid asha \(you\) ₹200 · for October 2026 · note: UPI/);
    expect((await tool(client, "list_payments", { space: "Flat 4B", person: "chen" })).text).toMatch(/^1 payment in Flat 4B, involving chen, ₹50 in all\./);
    expect((await tool(client, "list_payments", { space: "Flat 4B", month: "2026-10" })).text).toMatch(/^1 payment in Flat 4B, settling October 2026, ₹200/);
  });

  it("tells assistants that only the named people share a cost", async () => {
    await flat();
    const client = await connect(await makeKey());
    const add = (await client.listTools()).tools.find((t) => t.name === "add_expense")!;
    const props = (add.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(props.split_between!.description).toContain('the payer and "me" are not added unless listed');
    expect(client.getInstructions()).toContain('"Split with Chen" or "split with Boys" means only Chen or only the Boys group');
  });

  it("pages and filters past 5,000 rows in the database, for expenses and payments", async () => {
    const { space, ashaId, chenId } = await flat();
    await api.db.query(
      `INSERT INTO expenses (id, space_id, description, amount_paise, payer_id, split_type, spent_on, created_at, created_by, updated_by)
       SELECT gen_random_uuid(), $1, 'Vol ' || g, 100, $2, 'equal', '2026-10-15', now() - g * interval '1 second', $2, $2 FROM generate_series(1, 5001) g`,
      [space.id, ashaId],
    );
    await api.db.query(`INSERT INTO expense_shares (expense_id, user_id, share_paise) SELECT id, $2, 100 FROM expenses WHERE space_id = $1`, [space.id, ashaId]);
    // The oldest row is the 5,001st: reachable by offset, and findable by a filter.
    await api.db.query(`UPDATE expenses SET description = 'Oldest 100% juice_box' WHERE space_id = $1 AND description = 'Vol 5001'`, [space.id]);
    const client = await connect(await makeKey());
    const end = await tool(client, "list_expenses", { space: "Flat 4B", limit: 200, offset: 4900 });
    expect(end.text).toMatch(/^5,001 expenses in Flat 4B, ₹5,001 in all\. Showing 4,901–5,001 of 5,001\./);
    expect((await tool(client, "list_expenses", { space: "Flat 4B", limit: 200, offset: 4800 })).text).toMatch(/Showing 4,801–5,000 of 5,001; use offset 5000 for more\./);
    const last = await tool(client, "list_expenses", { space: "Flat 4B", limit: 200, offset: 5000 });
    expect(last.text).toMatch(/Showing 5,001–5,001 of 5,001\.\n- 2026-10-15 · Oldest 100% juice_box/);
    // "%" and "_" are literal text, not wildcards.
    const found = await tool(client, "list_expenses", { space: "Flat 4B", search: "100% juice_" });
    expect(found.text).toMatch(/ 1 is matching "100% juice_", ₹1 in all\. Showing 1–1 of 1\./);
    expect((await tool(client, "list_expenses", { space: "Flat 4B", search: "1_0" })).text).toMatch(/ 0 are matching "1_0", ₹0 in all\. Nothing matches\./);

    await api.db.query(
      `INSERT INTO settlements (id, space_id, from_user_id, to_user_id, amount_paise, paid_on, period, created_at, created_by)
       SELECT gen_random_uuid(), $1, $2, $3, 100, '2026-10-16', '2026-10-01', now() - g * interval '1 second', $3 FROM generate_series(1, 5001) g`,
      [space.id, chenId, ashaId],
    );
    const pays = await tool(client, "list_payments", { space: "Flat 4B" });
    expect(pays.text).toMatch(/^5,001 payments in Flat 4B, ₹5,001 in all\. Showing 1–50 of 5,001; use offset 50 for more\./);
    expect(pays.text.split("\n")).toHaveLength(51);
    expect((await tool(client, "list_payments", { space: "Flat 4B", offset: 5000 })).text).toMatch(/Showing 5,001–5,001 of 5,001\.\n- 2026-10-16 · chen paid asha/);
  });

  it("finds people who have left when reading history, but not for new expenses or payments", async () => {
    const { space, ashaId, balaId } = await flat();
    await api.call(asha, "POST", `/spaces/${space.id}/expenses`, { id: newId(), description: "Movie", amountPaise: 400, payerId: ashaId, splitType: "equal", spentOn: "2026-10-01", splits: [{ userId: ashaId }, { userId: balaId }] });
    await api.call(asha, "POST", `/spaces/${space.id}/settlements`, { id: newId(), fromUserId: balaId, toUserId: ashaId, amountPaise: 200, paidOn: "2026-10-02" });
    expect((await api.call(asha, "DELETE", `/spaces/${space.id}/members/${balaId}`)).status).toBe(204);
    const client = await connect(await makeKey());
    expect((await tool(client, "list_expenses", { space: "Flat 4B", involving: "bala" })).text).toMatch(/ 1 is involving bala, ₹4 in all, of which bala's share is ₹2\./);
    expect((await tool(client, "list_payments", { space: "Flat 4B", person: "bala" })).text).toMatch(/^1 payment in Flat 4B, involving bala, ₹2 in all\./);
    const add = await tool(client, "add_expense", { space: "Flat 4B", description: "Tea", amount: 10, split_between: ["bala"] });
    expect(add).toMatchObject({ isError: true });
    expect(add.text).toContain('No person called "bala"');
    expect((await tool(client, "record_payment", { space: "Flat 4B", from: "bala", to: "me", amount: 1 })).isError).toBe(true);
  });

  it("refuses split_between and split_values that name different people", async () => {
    const { space } = await flat();
    const client = await connect(await makeKey());
    const bad = await tool(client, "add_expense", {
      space: "Flat 4B", description: "Cab", amount: 100, split_type: "percent", split_between: ["me"],
      split_values: [{ person: "me", value: 60 }, { person: "chen", value: 40 }],
    });
    expect(bad).toMatchObject({ isError: true });
    expect(bad.text).toMatch(/split_between \(asha \(you\)\) and split_values \(asha \(you\), chen\) name different people/);
    expect(await all(space.id)).toHaveLength(0);
    const same = await tool(client, "add_expense", {
      space: "Flat 4B", description: "Cab", amount: 100, split_type: "percent", split_between: ["chen", "me"],
      split_values: [{ person: "me", value: 60 }, { person: "chen", value: 40 }],
    });
    expect(same.isError).toBe(false);
  });
});
