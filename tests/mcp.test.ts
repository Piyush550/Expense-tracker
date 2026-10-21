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
        ["add_expense", "add_expenses", "edit_expense", "get_balances", "get_space", "list_expenses", "list_spaces", "record_payment"].sort(),
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
    expect(added.text).toContain("You're owed ₹450 in Flat 4B.");
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

    const resplit = await tool(client, "edit_expense", { expense_id: gas.id, amount: 400, split_type: "equal", split_between: ["everyone"] });
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
