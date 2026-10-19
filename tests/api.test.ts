import { beforeEach, describe, expect, it } from "vitest";
import type { Balances, Expense, Group, Me, MonthSummary, Person, Settlement, SpaceDetail, SpaceSummary } from "../shared/api";
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

async function makeSpace(owner = asha, emails: string[] = [bala.email, chen.email]) {
  const res = await api.call<SpaceDetail>(owner, "POST", "/spaces", { name: "Flat", memberEmails: emails });
  expect(res.status).toBe(201);
  return res.body;
}

const idOf = (g: SpaceDetail, email: string) => g.members.find((m) => m.email === email)!.id;

async function addExpense(as: typeof asha, spaceId: string, body: Record<string, unknown>) {
  return api.call<Expense>(as, "POST", `/spaces/${spaceId}/expenses`, {
    id: newId(),
    description: "Dinner",
    splitType: "equal",
    spentOn: "2026-10-05",
    ...body,
  });
}

async function balances(spaceId: string, as = asha, month?: string) {
  return (await api.call<Balances>(as, "GET", `/spaces/${spaceId}/balances${month ? `?month=${month}` : ""}`)).body;
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

describe("spaces and members", () => {
  it("invites by email and hands the placeholder over on first sign-in", async () => {
    const g = await makeSpace();
    const balaPlaceholder = g.members.find((m) => m.email === bala.email)!;
    expect(balaPlaceholder.registered).toBe(false);

    const balaMe = await me(bala);
    expect(balaMe.id).toBe(balaPlaceholder.id);
    const list = await api.call<SpaceSummary[]>(bala, "GET", "/spaces");
    expect(list.body.map((x) => x.id)).toEqual([g.id]);
    const detail = await api.call<SpaceDetail>(asha, "GET", `/spaces/${g.id}`);
    expect(detail.body.members.find((m) => m.id === balaMe.id)!.registered).toBe(true);
  });

  it("hides spaces from people who are not in them", async () => {
    const g = await makeSpace();
    expect((await api.call(dev, "GET", `/spaces/${g.id}`)).status).toBe(404);
    expect((await api.call(dev, "GET", `/spaces/${g.id}/expenses`)).status).toBe(404);
    expect((await api.call(dev, "GET", `/spaces/${g.id}/balances`)).status).toBe(404);
    expect((await addExpense(dev, g.id, { amountPaise: 100, payerId: (await me(dev)).id, splits: [] })).status).toBe(404);
    expect((await api.call(dev, "GET", `/spaces/not-a-uuid`)).status).toBe(404);
  });

  it("does not add the same person twice", async () => {
    const g = await makeSpace();
    const res = await api.call(asha, "POST", `/spaces/${g.id}/members`, { email: "BALA@example.com" });
    expect(res.status).toBe(409);
  });

  it("only owners remove others; members can leave when square", async () => {
    const g = await makeSpace();
    await me(bala);
    const chenId = idOf(g, chen.email);
    expect((await api.call(bala, "DELETE", `/spaces/${g.id}/members/${chenId}`)).status).toBe(403);
    expect((await api.call(asha, "DELETE", `/spaces/${g.id}/members/${chenId}`)).status).toBe(204);
    expect((await api.call(bala, "DELETE", `/spaces/${g.id}/members/${(await me(bala)).id}`)).status).toBe(204);
    expect((await api.call(bala, "GET", `/spaces/${g.id}`)).status).toBe(404);
  });

  it("keeps an owner and refuses to drop someone who still owes money", async () => {
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const leave = await api.call(asha, "DELETE", `/spaces/${g.id}/members/${ashaId}`);
    expect(leave.body).toMatchObject({ error: { code: "last_owner" } });

    await addExpense(asha, g.id, { amountPaise: 1000, payerId: ashaId, splits: [{ userId: ashaId }, { userId: balaId }] });
    const remove = await api.call(asha, "DELETE", `/spaces/${g.id}/members/${balaId}`);
    expect(remove.body).toMatchObject({ error: { code: "member_has_balance" } });

    await api.call(asha, "POST", `/spaces/${g.id}/settlements`, {
      id: newId(), fromUserId: balaId, toUserId: ashaId, amountPaise: 500, paidOn: "2026-10-06",
    });
    expect((await api.call(asha, "DELETE", `/spaces/${g.id}/members/${balaId}`)).status).toBe(204);
    // A former member still shows up (expenses name them) but is marked inactive.
    const detail = await api.call<SpaceDetail>(asha, "GET", `/spaces/${g.id}`);
    expect(detail.body.members.find((m) => m.id === balaId)!.active).toBe(false);
  });

  it("refuses to delete a space with open balances", async () => {
    const g = await makeSpace();
    const ashaId = (await me()).id;
    await addExpense(asha, g.id, { amountPaise: 900, payerId: ashaId, splits: [{ userId: ashaId }, { userId: idOf(g, bala.email) }] });
    expect((await api.call(asha, "DELETE", `/spaces/${g.id}`)).status).toBe(409);
    await me(bala);
    expect((await api.call(bala, "DELETE", `/spaces/${g.id}`)).status).toBe(403);
  });

  it("merges an imported name into a real account", async () => {
    const g = await makeSpace(asha, []);
    const ashaId = (await me()).id;
    // Legacy-style placeholder with no email, as the Firebase import creates.
    const { rows } = await api.db.query<{ id: string }>("INSERT INTO users (name) VALUES ('Old Bala') RETURNING id");
    const oldId = rows[0]!.id;
    await api.db.query("INSERT INTO space_members (space_id, user_id) VALUES ($1, $2)", [g.id, oldId]);
    await api.call(asha, "POST", `/spaces/${g.id}/members`, { email: bala.email });
    const balaId = (await me(bala)).id;

    await addExpense(asha, g.id, { amountPaise: 900, payerId: oldId, splits: [{ userId: ashaId }, { userId: oldId }, { userId: balaId }] });
    const before = await balances(g.id);

    // Only the account holder (or an owner) may claim it.
    const merged = await api.call<SpaceDetail>(bala, "POST", `/spaces/${g.id}/members/${oldId}/merge`, { intoUserId: balaId });
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
    const g = await makeSpace();
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
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const body = { id: newId(), description: "Cab", amountPaise: 500, payerId: ashaId, splitType: "equal", spentOn: "2026-10-01", splits: [{ userId: ashaId }, { userId: idOf(g, bala.email) }] };
    expect((await api.call(asha, "POST", `/spaces/${g.id}/expenses`, body)).status).toBe(201);
    expect((await api.call(asha, "POST", `/spaces/${g.id}/expenses`, body)).status).toBe(200);
    const list = await api.call<Expense[]>(asha, "GET", `/spaces/${g.id}/expenses`);
    expect(list.body).toHaveLength(1);
  });

  it("supports exact, percent and share splits and validates them", async () => {
    const g = await makeSpace();
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

  it("rejects people who are not in the space", async () => {
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const devId = (await me(dev)).id;
    const res = await addExpense(asha, g.id, { amountPaise: 100, payerId: devId, splits: [{ userId: ashaId }] });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "not_a_member" } });
  });

  it("validates input", async () => {
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const res = await addExpense(asha, g.id, { amountPaise: 1.5, payerId: ashaId, spentOn: "2026-02-30", splits: [{ userId: ashaId }] });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("detects concurrent edits with the version number", async () => {
    const g = await makeSpace();
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
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const sept = (await addExpense(asha, g.id, { amountPaise: 1000, payerId: ashaId, spentOn: "2026-09-30", splits: [{ userId: balaId }] })).body;
    await addExpense(asha, g.id, { amountPaise: 400, payerId: ashaId, spentOn: "2026-10-01", splits: [{ userId: balaId }] });
    const oct = await api.call<Expense[]>(asha, "GET", `/spaces/${g.id}/expenses?month=2026-10`);
    expect(oct.body.map((e) => e.amountPaise)).toEqual([400]);
    expect((await api.call<SpaceDetail>(asha, "GET", `/spaces/${g.id}`)).body.months).toEqual(["2026-10", "2026-09"]);

    expect((await api.call(asha, "DELETE", `/expenses/${sept.id}`)).status).toBe(204);
    expect((await api.call(asha, "DELETE", `/expenses/${sept.id}`)).status).toBe(404);
    const b = await balances(g.id);
    expect(b.members.find((m) => m.userId === ashaId)!.netPaise).toBe(400);
  });

  it("brings everyone to zero once the suggested payments are recorded", async () => {
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const chenId = idOf(g, chen.email);
    const all = [{ userId: ashaId }, { userId: balaId }, { userId: chenId }];
    await addExpense(asha, g.id, { amountPaise: 90000, payerId: ashaId, splits: all });
    await addExpense(asha, g.id, { amountPaise: 30000, payerId: balaId, splits: all });
    await addExpense(asha, g.id, { amountPaise: 12345, payerId: chenId, splits: [{ userId: ashaId }, { userId: chenId }] });

    for (const t of (await balances(g.id)).transfers) {
      const r = await api.call<Settlement>(asha, "POST", `/spaces/${g.id}/settlements`, {
        id: newId(), fromUserId: t.from, toUserId: t.to, amountPaise: t.amountPaise, paidOn: "2026-10-31",
      });
      expect(r.status).toBe(201);
    }
    const after = await balances(g.id);
    expect(after.transfers).toEqual([]);
    expect(after.members.every((m) => m.netPaise === 0)).toBe(true);
    const spaces = await api.call<SpaceSummary[]>(asha, "GET", "/spaces");
    expect(spaces.body[0]!.myBalancePaise).toBe(0);
  });

  it("shows direct debts per pair when simplification is off", async () => {
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const chenId = idOf(g, chen.email);
    // bala owes asha 500, chen owes bala 500. Simplified: chen pays asha directly.
    await addExpense(asha, g.id, { amountPaise: 500, payerId: ashaId, splits: [{ userId: balaId }] });
    await addExpense(asha, g.id, { amountPaise: 500, payerId: balaId, splits: [{ userId: chenId }] });
    expect((await balances(g.id)).transfers).toEqual([{ from: chenId, to: ashaId, amountPaise: 500 }]);

    await api.call(asha, "PATCH", `/spaces/${g.id}`, { simplifyDebts: false });
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
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const pay = await api.call<Settlement>(asha, "POST", `/spaces/${g.id}/settlements`, {
      id: newId(), fromUserId: balaId, toUserId: ashaId, amountPaise: 100, paidOn: "2026-10-02",
    });
    const self = await api.call(asha, "POST", `/spaces/${g.id}/settlements`, {
      id: newId(), fromUserId: ashaId, toUserId: ashaId, amountPaise: 100, paidOn: "2026-10-02",
    });
    expect(self.status).toBe(422);
    expect((await api.call(dev, "DELETE", `/settlements/${pay.body.id}`)).status).toBe(404);
    expect((await api.call(asha, "DELETE", `/settlements/${pay.body.id}`)).status).toBe(204);
    expect((await balances(g.id)).transfers).toEqual([]);
  });
});

describe("permissions", () => {
  it("lets members add expenses but only owners manage people and settings", async () => {
    const g = await makeSpace();
    const balaId = (await me(bala)).id;
    expect((await api.call(bala, "POST", `/spaces/${g.id}/members`, { email: dev.email })).status).toBe(403);
    expect((await api.call(bala, "PATCH", `/spaces/${g.id}`, { name: "Mine now" })).status).toBe(403);
    expect((await addExpense(bala, g.id, { amountPaise: 300, payerId: balaId, splits: [{ userId: balaId }, { userId: (await me()).id }] })).status).toBe(201);
    const renamed = await api.call<SpaceDetail>(asha, "PATCH", `/spaces/${g.id}`, { name: "Goa trip", kind: "one_time" });
    expect(renamed.body).toMatchObject({ name: "Goa trip", kind: "one_time" });
  });
});

describe("groups (reusable lists of people)", () => {
  it("are shared with their members, editable only by their maker, and fill a space in one go", async () => {
    const made = await api.call<Group>(asha, "POST", "/groups", { name: "Boys Flat", memberEmails: [bala.email, chen.email] });
    expect(made.status).toBe(201);
    expect(made.body.members.map((m) => m.name).sort()).toEqual(["asha", "bala", "chen"]);
    expect(made.body.canEdit).toBe(true);

    // Bala is in it, so Bala sees it but cannot change it; Dev sees nothing.
    const balaView = await api.call<Group[]>(bala, "GET", "/groups");
    expect(balaView.body).toEqual([expect.objectContaining({ id: made.body.id, canEdit: false })]);
    expect((await api.call(bala, "PATCH", `/groups/${made.body.id}`, { name: "Ours" })).status).toBe(403);
    expect((await api.call<Group[]>(dev, "GET", "/groups")).body).toEqual([]);

    // A space built from the group has all three people.
    const space = await api.call<SpaceDetail>(asha, "POST", "/spaces", { name: "Groceries", groupIds: [made.body.id] });
    expect(space.body.members.filter((m) => m.active)).toHaveLength(3);

    // Change the group, then add it to another space: only the new person is added.
    const edited = await api.call<Group>(asha, "PATCH", `/groups/${made.body.id}`, { memberEmails: [bala.email, dev.email] });
    expect(edited.body.members.map((m) => m.name).sort()).toEqual(["asha", "bala", "dev"]);
    const add = await api.call<SpaceDetail>(asha, "POST", `/spaces/${space.body.id}/members`, { groupId: made.body.id });
    expect(add.body.members.filter((m) => m.active).map((m) => m.name).sort()).toEqual(["asha", "bala", "chen", "dev"]);
    expect((await api.call(asha, "POST", `/spaces/${space.body.id}/members`, { groupId: made.body.id })).status).toBe(409);

    // Someone who cannot see a group cannot use it.
    const devSpace = await api.call<SpaceDetail>(dev, "POST", "/spaces", { name: "Dev's" });
    const other = await api.call<Group>(chen, "POST", "/groups", { name: "Chen's", memberEmails: [] });
    expect((await api.call(dev, "POST", `/spaces/${devSpace.body.id}/members`, { groupId: other.body.id })).status).toBe(404);

    expect((await api.call(bala, "DELETE", `/groups/${made.body.id}`)).status).toBe(403);
    expect((await api.call(asha, "DELETE", `/groups/${made.body.id}`)).status).toBe(204);
    expect((await api.call<Group[]>(bala, "GET", "/groups")).body).toEqual([]);
  });
});

describe("recurring spaces, month by month", () => {
  it("settles each month on its own and shows a month sheet", async () => {
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    await addExpense(asha, g.id, { amountPaise: 1000, payerId: ashaId, spentOn: "2026-09-10", splits: [{ userId: ashaId }, { userId: balaId }] });
    await addExpense(asha, g.id, { amountPaise: 600, payerId: balaId, spentOn: "2026-10-03", splits: [{ userId: ashaId }, { userId: balaId }] });

    expect((await balances(g.id, asha, "2026-09")).transfers).toEqual([{ from: balaId, to: ashaId, amountPaise: 500 }]);
    expect((await balances(g.id, asha, "2026-10")).transfers).toEqual([{ from: ashaId, to: balaId, amountPaise: 300 }]);
    // Over all time the two months net off.
    expect((await balances(g.id)).transfers).toEqual([{ from: balaId, to: ashaId, amountPaise: 200 }]);

    // September's dues paid on 2 October still count for September.
    const pay = await api.call<Settlement>(bala, "POST", `/spaces/${g.id}/settlements`, {
      id: newId(), fromUserId: balaId, toUserId: ashaId, amountPaise: 500, paidOn: "2026-10-02", period: "2026-09",
    });
    expect(pay.body.period).toBe("2026-09");
    expect((await balances(g.id, asha, "2026-09")).transfers).toEqual([]);
    expect((await balances(g.id, asha, "2026-10")).transfers).toEqual([{ from: ashaId, to: balaId, amountPaise: 300 }]);
    const sept = await api.call<Settlement[]>(asha, "GET", `/spaces/${g.id}/settlements?month=2026-09`);
    expect(sept.body.map((s) => s.id)).toEqual([pay.body.id]);

    const sheet = await api.call<MonthSummary[]>(asha, "GET", `/spaces/${g.id}/months`);
    expect(sheet.body).toEqual([
      { month: "2026-10", spentPaise: 600, expenseCount: 1, outstandingPaise: 300 },
      { month: "2026-09", spentPaise: 1000, expenseCount: 1, outstandingPaise: 0 },
    ]);
  });
});

describe("people you know", () => {
  it("lists people you share a space or group with, and adds them without an email", async () => {
    const g = await makeSpace(); // Asha's space with Bala and Chen invited
    const balaId = idOf(g, bala.email);
    const chenId = idOf(g, chen.email);
    const devId = (await me(dev)).id; // a stranger to Asha

    const people = await api.call<Person[]>(asha, "GET", "/people");
    expect(people.body.map((p) => p.name)).toEqual(["bala", "chen"]);
    expect((await api.call<Person[]>(dev, "GET", "/people")).body).toEqual([]);

    const trip = await api.call<SpaceDetail>(asha, "POST", "/spaces", { name: "Trip", kind: "one_time", memberIds: [balaId] });
    expect(trip.status).toBe(201);
    expect(trip.body.members.map((m) => m.name).sort()).toEqual(["asha", "bala"]);
    expect((await api.call(asha, "POST", `/spaces/${trip.body.id}/members`, { userId: chenId })).status).toBe(201);
    expect((await api.call(asha, "POST", `/spaces/${trip.body.id}/members`, { userId: chenId })).status).toBe(409);

    // Nobody can add a stranger by id.
    expect((await api.call(asha, "POST", `/spaces/${trip.body.id}/members`, { userId: devId })).status).toBe(404);
    expect((await api.call(asha, "POST", "/spaces", { name: "Nope", memberIds: [devId] })).status).toBe(404);

    const grp = await api.call<Group>(asha, "POST", "/groups", { name: "Flatmates", memberIds: [balaId] });
    expect(grp.body.members.map((m) => m.name).sort()).toEqual(["asha", "bala"]);
    const swapped = await api.call<Group>(asha, "PATCH", `/groups/${grp.body.id}`, { memberIds: [chenId], memberEmails: [dev.email] });
    expect(swapped.body.members.map((m) => m.name).sort()).toEqual(["asha", "chen", "dev"]);
    // Bala was taken out, so the group is no longer visible to Bala at all.
    expect((await api.call(bala, "PATCH", `/groups/${grp.body.id}`, { memberIds: [] })).status).toBe(404);
    // Dev is in Asha's group now, so they know each other.
    expect((await api.call<Person[]>(dev, "GET", "/people")).body.map((p) => p.name).sort()).toEqual(["asha", "chen"]);
  });
});

describe("bulk add", () => {
  it("saves every row in one go, all or nothing, and is safe to retry", async () => {
    const g = await makeSpace();
    const ashaId = (await me()).id;
    const balaId = idOf(g, bala.email);
    const devId = (await me(dev)).id;
    const row = (description: string, amountPaise: number, payerId = ashaId) => ({
      id: newId(), description, amountPaise, payerId, splitType: "equal", spentOn: "2026-10-18",
      splits: [{ userId: ashaId }, { userId: balaId }],
    });

    // One bad row (Dev is not in the space) stops the whole batch and names the row.
    const bad = await api.call<{ error: { message: string; details: { index: number } } }>(asha, "POST", `/spaces/${g.id}/expenses/bulk`, {
      expenses: [row("Milk", 6000), row("Bread", 4000, devId), row("Eggs", 9000)],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toEqual({ index: 1 });
    expect(bad.body.error.message).toMatch(/^Row 2:/);
    expect((await api.call<Expense[]>(asha, "GET", `/spaces/${g.id}/expenses`)).body).toHaveLength(0);

    const batch = { expenses: [row("Milk", 6000), row("Bread", 4000, balaId), row("Eggs", 9000)] };
    const ok = await api.call<{ expenses: Expense[] }>(asha, "POST", `/spaces/${g.id}/expenses/bulk`, batch);
    expect(ok.status).toBe(201);
    expect(ok.body.expenses.map((e) => e.description)).toEqual(["Milk", "Bread", "Eggs"]);
    expect((await balances(g.id)).transfers).toEqual([{ from: balaId, to: ashaId, amountPaise: 5500 }]);

    // The same request again (e.g. the network dropped the reply) adds nothing new.
    expect((await api.call(asha, "POST", `/spaces/${g.id}/expenses/bulk`, batch)).status).toBe(201);
    expect((await api.call<Expense[]>(asha, "GET", `/spaces/${g.id}/expenses`)).body).toHaveLength(3);

    // Input checks still apply per row, and outsiders cannot use it.
    const invalid = await api.call(asha, "POST", `/spaces/${g.id}/expenses/bulk`, { expenses: [{ ...row("x", 100), amountPaise: -1 }] });
    expect(invalid.status).toBe(422);
    expect((await api.call(dev, "POST", `/spaces/${g.id}/expenses/bulk`, batch)).status).toBe(404);
    expect((await api.call(asha, "POST", `/spaces/${g.id}/expenses/bulk`, { expenses: [] })).status).toBe(422);
  });
});
