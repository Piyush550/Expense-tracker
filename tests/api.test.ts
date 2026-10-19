import { beforeEach, describe, expect, it } from "vitest";
import type { Balances, Expense, GroupDetail, GroupSummary, Me, Settlement } from "../shared/api";
import { newId, person, setup } from "./helpers";

type Api = Awaited<ReturnType<typeof setup>>;

const asha = person("asha");
const bala = person("bala");
const chen = person("chen");
const dev = person("dev");

let api: Api;

async function me(p = asha) {
  return (await api.call<Me>(p, "GET", "/me")).body;
}

async function makeGroup(owner = asha, emails: string[] = [bala.email, chen.email]) {
  const res = await api.call<GroupDetail>(owner, "POST", "/groups", { name: "Flat", memberEmails: emails });
  expect(res.status).toBe(201);
  return res.body;
}

const idOf = (g: GroupDetail, email: string) => g.members.find((m) => m.email === email)!.id;

async function addExpense(as: typeof asha, groupId: string, body: Record<string, unknown>) {
  return api.call<Expense>(as, "POST", `/groups/${groupId}/expenses`, {
    id: newId(),
    description: "Dinner",
    splitType: "equal",
    spentOn: "2026-10-05",
    ...body,
  });
}

async function balances(groupId: string, as = asha) {
  return (await api.call<Balances>(as, "GET", `/groups/${groupId}/balances`)).body;
}

beforeEach(async () => {
  api = await setup();
});

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const res = await api.call(null, "GET", "/me");
    expect(res.status).toBe(401);
  });

  it("rejects unverified email accounts", async () => {
    const res = await api.call({ ...asha, emailVerified: false }, "GET", "/me");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "email_unverified" } });
  });

  it("creates the user on first sign-in and reuses it after", async () => {
    const first = await me();
    expect(first).toMatchObject({ name: "asha", email: "asha@example.com" });
    expect((await me()).id).toBe(first.id);
  });

  it("lets a user rename themselves", async () => {
    const res = await api.call<Me>(asha, "PATCH", "/me", { name: "  Asha R  " });
    expect(res.body.name).toBe("Asha R");
    expect((await me()).name).toBe("Asha R");
  });

  it("requires JSON bodies", async () => {
    const res = await api.call(asha, "PATCH", "/me");
    expect(res.status).toBe(415);
  });
});

describe("groups and members", () => {
  it("invites by email and hands the placeholder over on first sign-in", async () => {
    const g = await makeGroup();
    const balaPlaceholder = g.members.find((m) => m.email === bala.email)!;
    expect(balaPlaceholder.registered).toBe(false);

    const balaMe = await me(bala);
    expect(balaMe.id).toBe(balaPlaceholder.id);
    const list = await api.call<GroupSummary[]>(bala, "GET", "/groups");
    expect(list.body.map((x) => x.id)).toEqual([g.id]);
    const detail = await api.call<GroupDetail>(asha, "GET", `/groups/${g.id}`);
    expect(detail.body.members.find((m) => m.id === balaMe.id)!.registered).toBe(true);
  });

  it("hides groups from people who are not in them", async () => {
    const g = await makeGroup();
    expect((await api.call(dev, "GET", `/groups/${g.id}`)).status).toBe(404);
    expect((await api.call(dev, "GET", `/groups/${g.id}/expenses`)).status).toBe(404);
    expect((await api.call(dev, "GET", `/groups/${g.id}/balances`)).status).toBe(404);
    expect((await addExpense(dev, g.id, { amountPaise: 100, payerId: (await me(dev)).id, splits: [] })).status).toBe(404);
    expect((await api.call(dev, "GET", `/groups/not-a-uuid`)).status).toBe(404);
  });

  it("does not add the same person twice", async () => {
    const g = await makeGroup();
    const res = await api.call(asha, "POST", `/groups/${g.id}/members`, { email: "BALA@example.com" });
    expect(res.status).toBe(409);
  });

  it("only owners remove others; members can leave when square", async () => {
    const g = await makeGroup();
    await me(bala);
    const chenId = idOf(g, chen.email);
    expect((await api.call(bala, "DELETE", `/groups/${g.id}/members/${chenId}`)).status).toBe(403);
    expect((await api.call(asha, "DELETE", `/groups/${g.id}/members/${chenId}`)).status).toBe(204);
    expect((await api.call(bala, "DELETE", `/groups/${g.id}/members/${(await me(bala)).id}`)).status).toBe(204);
    expect((await api.call(bala, "GET", `/groups/${g.id}`)).status).toBe(404);
  });

  it("keeps an owner and refuses to drop someone who still owes money", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const leave = await api.call(asha, "DELETE", `/groups/${g.id}/members/${ashaId}`);
    expect(leave.body).toMatchObject({ error: { code: "last_owner" } });

    await addExpense(asha, g.id, { amountPaise: 1000, payerId: ashaId, splits: [{ userId: ashaId }, { userId: balaId }] });
    const remove = await api.call(asha, "DELETE", `/groups/${g.id}/members/${balaId}`);
    expect(remove.body).toMatchObject({ error: { code: "member_has_balance" } });

    await api.call(asha, "POST", `/groups/${g.id}/settlements`, {
      id: newId(), fromUserId: balaId, toUserId: ashaId, amountPaise: 500, paidOn: "2026-10-06",
    });
    expect((await api.call(asha, "DELETE", `/groups/${g.id}/members/${balaId}`)).status).toBe(204);
    // A former member still shows up (expenses name them) but is marked inactive.
    const detail = await api.call<GroupDetail>(asha, "GET", `/groups/${g.id}`);
    expect(detail.body.members.find((m) => m.id === balaId)!.active).toBe(false);
  });

  it("refuses to delete a group with open balances", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    await addExpense(asha, g.id, { amountPaise: 900, payerId: ashaId, splits: [{ userId: ashaId }, { userId: idOf(g, bala.email) }] });
    expect((await api.call(asha, "DELETE", `/groups/${g.id}`)).status).toBe(409);
    await me(bala);
    expect((await api.call(bala, "DELETE", `/groups/${g.id}`)).status).toBe(403);
  });

  it("merges an imported name into a real account", async () => {
    const g = await makeGroup(asha, []);
    const ashaId = (await me()).id;
    // Legacy-style placeholder with no email, as the Firebase import creates.
    const { rows } = await api.db.query<{ id: string }>("INSERT INTO users (name) VALUES ('Old Bala') RETURNING id");
    const oldId = rows[0]!.id;
    await api.db.query("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)", [g.id, oldId]);
    await api.call(asha, "POST", `/groups/${g.id}/members`, { email: bala.email });
    const balaId = (await me(bala)).id;

    await addExpense(asha, g.id, { amountPaise: 900, payerId: oldId, splits: [{ userId: ashaId }, { userId: oldId }, { userId: balaId }] });
    const before = await balances(g.id);

    // Only the account holder (or an owner) may claim it.
    const merged = await api.call<GroupDetail>(bala, "POST", `/groups/${g.id}/members/${oldId}/merge`, { intoUserId: balaId });
    expect(merged.status).toBe(200);
    expect(merged.body.members.some((m) => m.id === oldId)).toBe(false);

    const after = await balances(g.id);
    const net = (b: Balances, id: string) => b.members.find((m) => m.userId === id)?.netPaise ?? 0;
    expect(net(after, balaId)).toBe(net(before, balaId) + net(before, oldId));
    expect(net(after, ashaId)).toBe(net(before, ashaId));
  });
});

describe("expenses and balances", () => {
  it("records an equal split and suggests who pays whom", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const chenId = idOf(g, chen.email);
    const res = await addExpense(asha, g.id, {
      amountPaise: 30001,
      payerId: ashaId,
      splits: [{ userId: ashaId }, { userId: balaId }, { userId: chenId }],
    });
    expect(res.status).toBe(201);
    expect(res.body.shares.reduce((a, s) => a + s.sharePaise, 0)).toBe(30001);

    const b = await balances(g.id);
    expect(b.members.reduce((a, m) => a + m.netPaise, 0)).toBe(0);
    expect(b.transfers).toHaveLength(2);
    expect(b.transfers.every((t) => t.to === ashaId)).toBe(true);
    expect(b.transfers.reduce((a, t) => a + t.amountPaise, 0)).toBe(30001 - res.body.shares.find((s) => s.userId === ashaId)!.sharePaise);
  });

  it("treats a retried create as the same expense", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const body = { id: newId(), description: "Cab", amountPaise: 500, payerId: ashaId, splitType: "equal", spentOn: "2026-10-01", splits: [{ userId: ashaId }, { userId: idOf(g, bala.email) }] };
    expect((await api.call(asha, "POST", `/groups/${g.id}/expenses`, body)).status).toBe(201);
    expect((await api.call(asha, "POST", `/groups/${g.id}/expenses`, body)).status).toBe(200);
    const list = await api.call<Expense[]>(asha, "GET", `/groups/${g.id}/expenses`);
    expect(list.body).toHaveLength(1);
  });

  it("supports exact, percent and share splits and validates them", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const exact = await addExpense(asha, g.id, { amountPaise: 1000, payerId: ashaId, splitType: "exact", splits: [{ userId: ashaId, value: 400 }, { userId: balaId, value: 600 }] });
    expect(exact.status).toBe(201);
    const bad = await addExpense(asha, g.id, { amountPaise: 1000, payerId: ashaId, splitType: "exact", splits: [{ userId: ashaId, value: 400 }, { userId: balaId, value: 500 }] });
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({ error: { code: "invalid_split" } });
    const pct = await addExpense(asha, g.id, { amountPaise: 1001, payerId: balaId, splitType: "percent", splits: [{ userId: ashaId, value: 2500 }, { userId: balaId, value: 7500 }] });
    expect(pct.body.shares.reduce((a, s) => a + s.sharePaise, 0)).toBe(1001);
    const shares = await addExpense(asha, g.id, { amountPaise: 900, payerId: ashaId, splitType: "shares", splits: [{ userId: ashaId, value: 1 }, { userId: balaId, value: 2 }] });
    expect(shares.body.shares.map((s) => [s.userId, s.sharePaise])).toEqual(
      expect.arrayContaining([[ashaId, 300], [balaId, 600]]),
    );
  });

  it("rejects people who are not in the group", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const devId = (await me(dev)).id;
    const res = await addExpense(asha, g.id, { amountPaise: 100, payerId: devId, splits: [{ userId: ashaId }] });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "not_a_member" } });
  });

  it("validates input", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const res = await addExpense(asha, g.id, { amountPaise: 1.5, payerId: ashaId, spentOn: "2026-02-30", splits: [{ userId: ashaId }] });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("detects concurrent edits with the version number", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const created = (await addExpense(asha, g.id, { amountPaise: 1000, payerId: ashaId, splits: [{ userId: ashaId }, { userId: balaId }] })).body;
    const edit = { version: created.version, description: "Lunch", amountPaise: 2000, payerId: ashaId, splitType: "equal", spentOn: created.spentOn, splits: [{ userId: ashaId }, { userId: balaId }] };
    const ok = await api.call<Expense>(asha, "PATCH", `/expenses/${created.id}`, edit);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ description: "Lunch", amountPaise: 2000, version: 2 });
    const stale = await api.call(asha, "PATCH", `/expenses/${created.id}`, edit);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: "version_conflict" } });
  });

  it("filters by month and leaves deleted expenses out of balances", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const sept = (await addExpense(asha, g.id, { amountPaise: 1000, payerId: ashaId, spentOn: "2026-09-30", splits: [{ userId: balaId }] })).body;
    await addExpense(asha, g.id, { amountPaise: 400, payerId: ashaId, spentOn: "2026-10-01", splits: [{ userId: balaId }] });
    const oct = await api.call<Expense[]>(asha, "GET", `/groups/${g.id}/expenses?month=2026-10`);
    expect(oct.body.map((e) => e.amountPaise)).toEqual([400]);
    expect((await api.call<GroupDetail>(asha, "GET", `/groups/${g.id}`)).body.months).toEqual(["2026-10", "2026-09"]);

    expect((await api.call(asha, "DELETE", `/expenses/${sept.id}`)).status).toBe(204);
    expect((await api.call(asha, "DELETE", `/expenses/${sept.id}`)).status).toBe(404);
    const b = await balances(g.id);
    expect(b.members.find((m) => m.userId === ashaId)!.netPaise).toBe(400);
  });

  it("brings everyone to zero once the suggested payments are recorded", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const chenId = idOf(g, chen.email);
    const all = [{ userId: ashaId }, { userId: balaId }, { userId: chenId }];
    await addExpense(asha, g.id, { amountPaise: 90000, payerId: ashaId, splits: all });
    await addExpense(asha, g.id, { amountPaise: 30000, payerId: balaId, splits: all });
    await addExpense(asha, g.id, { amountPaise: 12345, payerId: chenId, splits: [{ userId: ashaId }, { userId: chenId }] });

    for (const t of (await balances(g.id)).transfers) {
      const r = await api.call<Settlement>(asha, "POST", `/groups/${g.id}/settlements`, {
        id: newId(), fromUserId: t.from, toUserId: t.to, amountPaise: t.amountPaise, paidOn: "2026-10-31",
      });
      expect(r.status).toBe(201);
    }
    const after = await balances(g.id);
    expect(after.transfers).toEqual([]);
    expect(after.members.every((m) => m.netPaise === 0)).toBe(true);
    const groups = await api.call<GroupSummary[]>(asha, "GET", "/groups");
    expect(groups.body[0]!.myBalancePaise).toBe(0);
  });

  it("shows direct debts per pair when simplification is off", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const chenId = idOf(g, chen.email);
    // bala owes asha 500, chen owes bala 500. Simplified: chen pays asha directly.
    await addExpense(asha, g.id, { amountPaise: 500, payerId: ashaId, splits: [{ userId: balaId }] });
    await addExpense(asha, g.id, { amountPaise: 500, payerId: balaId, splits: [{ userId: chenId }] });
    expect((await balances(g.id)).transfers).toEqual([{ from: chenId, to: ashaId, amountPaise: 500 }]);

    await api.call(asha, "PATCH", `/groups/${g.id}`, { simplifyDebts: false });
    const pairwise = await balances(g.id);
    expect(pairwise.simplified).toBe(false);
    expect(pairwise.transfers).toHaveLength(2);
    expect(pairwise.transfers).toEqual(
      expect.arrayContaining([
        { from: balaId, to: ashaId, amountPaise: 500 },
        { from: chenId, to: balaId, amountPaise: 500 },
      ]),
    );
  });

  it("lets members delete payments and blocks outsiders", async () => {
    const g = await makeGroup();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const pay = await api.call<Settlement>(asha, "POST", `/groups/${g.id}/settlements`, {
      id: newId(), fromUserId: balaId, toUserId: ashaId, amountPaise: 100, paidOn: "2026-10-02",
    });
    const self = await api.call(asha, "POST", `/groups/${g.id}/settlements`, {
      id: newId(), fromUserId: ashaId, toUserId: ashaId, amountPaise: 100, paidOn: "2026-10-02",
    });
    expect(self.status).toBe(422);
    expect((await api.call(dev, "DELETE", `/settlements/${pay.body.id}`)).status).toBe(404);
    expect((await api.call(asha, "DELETE", `/settlements/${pay.body.id}`)).status).toBe(204);
    expect((await balances(g.id)).transfers).toEqual([]);
  });
});
