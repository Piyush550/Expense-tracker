import { beforeEach, describe, expect, it } from "vitest";
import type { ApiToken, Expense, Group, Me, NewApiToken, QuickExpenseResult, QuickOptions, SpaceDetail } from "../shared/api";
import { hashToken } from "../server/tokens";
import { todayInIndia } from "../server/quick";
import { newId, person, setup } from "./helpers";

type Api = Awaited<ReturnType<typeof setup>>;
const asha = person("asha");
const bala = person("bala");
const chen = person("chen");
let api: Api;

beforeEach(async () => {
  api = await setup();
});

async function makeToken(as = asha, name = "iPhone", lifetimeDays: number | null = 365) {
  const res = await api.call<NewApiToken>(as, "POST", "/tokens", { name, lifetimeDays });
  expect(res.status).toBe(201);
  return res.body;
}

async function flat() {
  const space = await api.call<SpaceDetail>(asha, "POST", "/spaces", { name: "Flat 4B", memberEmails: [bala.email, chen.email] });
  const ashaId = (await api.call<Me>(asha, "GET", "/me")).body.id;
  const balaId = space.body.members.find((m) => m.email === bala.email)!.id;
  const chenId = space.body.members.find((m) => m.email === chen.email)!.id;
  return { space: space.body, ashaId, balaId, chenId };
}

describe("personal tokens", () => {
  it("are shown once, stored only as a hash, and listed without the secret", async () => {
    const { token, info } = await makeToken();
    expect(token).toMatch(/^et_[A-Za-z0-9_-]{43}$/);
    expect(info).toMatchObject({ name: "iPhone", hint: token.slice(-4), status: "active", lifetimeDays: 365 });
    const stored = await api.db.query<{ token_hash: string }>("SELECT token_hash FROM api_tokens");
    expect(stored.rows).toEqual([{ token_hash: hashToken(token) }]);
    const list = await api.call<ApiToken[]>(asha, "GET", "/tokens");
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(list.body).toHaveLength(1);
  });

  it("sign in as their owner for everything except destructive routes", async () => {
    const { space, ashaId, balaId } = await flat();
    const { token } = await makeToken();
    expect((await api.call<Me>(token, "GET", "/me")).body.email).toBe(asha.email);
    // Reading and adding work like the app.
    expect((await api.call(token, "GET", "/spaces")).status).toBe(200);
    expect((await api.call(token, "GET", `/spaces/${space.id}/balances`)).status).toBe(200);
    expect((await api.call(token, "GET", "/people")).status).toBe(200);
    const added = await api.call<Expense>(token, "POST", `/spaces/${space.id}/expenses`, {
      id: newId(), description: "Cab", amountPaise: 600, payerId: ashaId, splitType: "equal", spentOn: "2026-10-05", splits: [{ userId: ashaId }, { userId: balaId }],
    });
    expect(added.status).toBe(201);
    expect((await api.call(token, "PATCH", `/expenses/${added.body.id}`, {
      version: 1, description: "Cab home", amountPaise: 600, payerId: ashaId, splitType: "equal", spentOn: "2026-10-05", splits: [{ userId: ashaId }, { userId: balaId }],
    })).status).toBe(200);
    expect((await api.call(token, "PATCH", "/me", { name: "Asha K" })).status).toBe(200);

    // Destructive or key-managing routes are refused.
    const refused: [string, string, unknown?][] = [
      ["DELETE", `/expenses/${added.body.id}`],
      ["DELETE", `/spaces/${space.id}`],
      ["DELETE", `/spaces/${space.id}/members/${balaId}`],
      ["POST", `/spaces/${space.id}/members/${balaId}/merge`, { intoUserId: ashaId }],
      ["GET", "/tokens"],
      ["POST", "/tokens", { name: "x" }],
    ];
    for (const [method, path, body] of refused) {
      const res = await api.call(token, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body).toMatchObject({ error: { code: "token_scope" } });
    }
    // The expense is still there; Google / email sign-in can still do everything.
    expect((await api.call(asha, "DELETE", `/expenses/${added.body.id}`)).status).toBe(204);
    expect((await api.call(null, "GET", "/quick/options")).status).toBe(401);
    expect((await api.call("et_made-up", "GET", "/quick/options")).status).toBe(401);
  });

  it("can be regenerated, renamed, given a new expiry, revoked and deleted", async () => {
    const { token, info } = await makeToken();
    const regen = await api.call<NewApiToken>(asha, "POST", `/tokens/${info.id}/regenerate`);
    expect(regen.status).toBe(200);
    expect(regen.body.token).not.toBe(token);
    expect((await api.call(token, "GET", "/me")).status).toBe(401);
    expect((await api.call(regen.body.token, "GET", "/me")).status).toBe(200);

    const renamed = await api.call<ApiToken>(asha, "PATCH", `/tokens/${info.id}`, { name: "Work phone", lifetimeDays: null });
    expect(renamed.body).toMatchObject({ name: "Work phone", lifetimeDays: null, expiresAt: null });

    expect((await api.call(asha, "DELETE", `/tokens/${info.id}`)).status).toBe(409); // still active
    const revoked = await api.call<ApiToken>(asha, "POST", `/tokens/${info.id}/revoke`);
    expect(revoked.body.status).toBe("revoked");
    expect((await api.call(regen.body.token, "GET", "/me")).status).toBe(401);
    expect((await api.call(asha, "POST", `/tokens/${info.id}/regenerate`)).status).toBe(409);
    expect((await api.call(asha, "DELETE", `/tokens/${info.id}`)).status).toBe(204);
    expect((await api.call<ApiToken[]>(asha, "GET", "/tokens")).body).toEqual([]);
  });

  it("stop working once expired, and regenerating starts a fresh lifetime", async () => {
    const { token, info } = await makeToken(asha, "Old", 30);
    await api.db.query("UPDATE api_tokens SET expires_at = now() - interval '1 day' WHERE id = $1", [info.id]);
    expect((await api.call(token, "GET", "/me")).status).toBe(401);
    expect((await api.call<ApiToken[]>(asha, "GET", "/tokens")).body[0]!.status).toBe("expired");
    const fresh = await api.call<NewApiToken>(asha, "POST", `/tokens/${info.id}/regenerate`);
    expect(fresh.body.info.status).toBe("active");
    expect(Date.parse(fresh.body.info.expiresAt!)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await api.call(fresh.body.token, "GET", "/me")).status).toBe(200);
  });

  it("belong to one user: nobody else can see or change them", async () => {
    const { info } = await makeToken(asha);
    expect((await api.call<ApiToken[]>(bala, "GET", "/tokens")).body).toEqual([]);
    expect((await api.call(bala, "POST", `/tokens/${info.id}/revoke`)).status).toBe(404);
    expect((await api.call(bala, "POST", `/tokens/${info.id}/regenerate`)).status).toBe(404);
    expect((await api.call(bala, "PATCH", `/tokens/${info.id}`, { name: "mine" })).status).toBe(404);
  });

  it("are limited to 10 active per user", async () => {
    for (let i = 0; i < 10; i++) await makeToken(asha, `t${i}`);
    expect((await api.call(asha, "POST", "/tokens", { name: "one more" })).status).toBe(409);
  });
});

describe("phone shortcut: quick add", () => {
  it("offers each space as Everyone plus its quick-action groups", async () => {
    const { space, ashaId, balaId } = await flat();
    await api.call<Group>(asha, "POST", `/spaces/${space.id}/groups`, { name: "Just us two", memberIds: [ashaId, balaId] });
    const { token } = await makeToken();
    const opts = await api.call<QuickOptions>(token, "GET", "/quick/options");
    expect(opts.body.labels).toEqual(["Flat 4B · Everyone", "Flat 4B · Just us two"]);
    expect(opts.body.presets[1]!.people.map((p) => p.name).sort()).toEqual(["asha", "bala"]);
    // Each token sees its own owner's spaces: Chen is in Flat 4B but not in "Just us two"'s
    // people; the presets are per space, so Chen sees both, and a stranger sees none.
    await api.call(chen, "GET", "/me");
    const chenToken = await makeToken(chen);
    expect((await api.call<QuickOptions>(chenToken.token, "GET", "/quick/options")).body.labels).toEqual(["Flat 4B · Everyone", "Flat 4B · Just us two"]);
    const stranger = person("zed");
    await api.call(stranger, "GET", "/me");
    const zedToken = await makeToken(stranger);
    expect((await api.call<QuickOptions>(zedToken.token, "GET", "/quick/options")).body.labels).toEqual([]);
  });

  it("adds an equal split paid by the token's owner and says so", async () => {
    const { space, ashaId, balaId, chenId } = await flat();
    const { token } = await makeToken();
    const res = await api.call<QuickExpenseResult>(token, "POST", "/quick/expense", { preset: "Flat 4B · Everyone", amount: 450, title: "Swiggy" });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Added ₹450 Swiggy to Flat 4B · split 3 ways. You're owed ₹300 there.");
    expect(res.body.expense).toMatchObject({ description: "Swiggy", amountPaise: 45000, payerId: ashaId, splitType: "equal", spentOn: todayInIndia() });
    expect(res.body.expense.shares.map((s) => s.userId).sort()).toEqual([ashaId, balaId, chenId].sort());

    // By preset id, a text amount with paise, and a date.
    const byId = await api.call<QuickExpenseResult>(token, "POST", "/quick/expense", { preset: `${space.id}.all`, amount: "99.50", title: "Milk", date: "2026-10-01" });
    expect(byId.body.expense).toMatchObject({ amountPaise: 9950, spentOn: "2026-10-01" });
    const list = await api.call<Expense[]>(asha, "GET", `/spaces/${space.id}/expenses`);
    expect(list.body).toHaveLength(2);
  });

  it("is safe to retry with a requestId, and rejects bad input clearly", async () => {
    await flat();
    const { token } = await makeToken();
    const body = { preset: "Flat 4B · Everyone", amount: 120, title: "Cab", requestId: newId() };
    expect((await api.call(token, "POST", "/quick/expense", body)).status).toBe(201);
    expect((await api.call(token, "POST", "/quick/expense", body)).status).toBe(200);
    const bad = async (patch: Record<string, unknown>) => (await api.call<{ error: { code: string } }>(token, "POST", "/quick/expense", { ...body, requestId: undefined, ...patch })).body.error.code;
    expect(await bad({ preset: "Nowhere · Everyone" })).toBe("unknown_preset");
    expect(await bad({ amount: 0 })).toBe("invalid_amount");
    expect(await bad({ amount: 12.345 })).toBe("invalid_amount");
    expect(await bad({ date: "someday" })).toBe("invalid_date");
  });

  it("cannot add to a space you have left", async () => {
    const { space, balaId } = await flat();
    await api.call(bala, "GET", "/me");
    const { token } = await makeToken(bala);
    expect((await api.call(bala, "DELETE", `/spaces/${space.id}/members/${balaId}`)).status).toBe(204);
    const res = await api.call<{ error: { code: string } }>(token, "POST", "/quick/expense", { preset: `${space.id}.all`, amount: 10, title: "x" });
    expect(res.body.error.code).toBe("unknown_preset");
  });
});

describe("phone shortcut: errors are readable in the notification", () => {
  it("puts a top-level message on failures from the shortcut's routes only", async () => {
    await flat();
    const { token, info } = await makeToken();
    const bad = await api.call<{ message: string; error: { code: string } }>(token, "POST", "/quick/expense", { preset: "Nowhere", amount: 10, title: "x" });
    expect(bad.status).toBe(422);
    expect(bad.body.message).toBe("Couldn't add the expense: That choice is not available any more. Run the shortcut again.");
    expect(bad.body.error.code).toBe("unknown_preset");

    await api.call(asha, "POST", `/tokens/${info.id}/revoke`);
    const revoked = await api.call<{ message: string }>(token, "POST", "/quick/expense", { preset: "Flat 4B · Everyone", amount: 10 });
    expect(revoked.status).toBe(401);
    expect(revoked.body.message).toBe("Couldn't add the expense: This key is not valid any more. Create a new one in the app under Settings → iPhone & AI apps.");
    const options = await api.call<{ message: string }>(token, "GET", "/quick/options");
    expect(options.body.message).toMatch(/^Couldn't load your choices: /);

    // Other routes keep the plain shape.
    const other = await api.call<Record<string, unknown>>(asha, "GET", "/spaces/not-a-uuid");
    expect(other.body.message).toBeUndefined();
  });
});

describe("phone shortcut: pick who shared it", () => {
  it("lists the space's people and splits only between the ones picked", async () => {
    const { space, ashaId, chenId } = await flat();
    const { token } = await makeToken();
    const names = await api.call<string[]>(token, "POST", "/quick/people", { preset: "Flat 4B · Everyone" });
    expect(names.status).toBe(200);
    expect(names.body.sort()).toEqual(["asha", "bala", "chen"]);

    // As a list (Shortcuts "Array" field)...
    const picked = await api.call<QuickExpenseResult>(token, "POST", "/quick/expense", { preset: "Flat 4B · Everyone", amount: 300, title: "Cab", people: ["asha", "Chen"] });
    expect(picked.status).toBe(201);
    expect(picked.body.expense.shares.map((s) => s.userId).sort()).toEqual([ashaId, chenId].sort());
    expect(picked.body.message).toBe("Added ₹300 Cab to Flat 4B · split 2 ways. You're owed ₹150 there.");

    // ...or as text, one name per line (Shortcuts "Text" field holding a list).
    const asText = await api.call<QuickExpenseResult>(token, "POST", "/quick/expense", { preset: `${space.id}.all`, amount: 100, title: "Tea", people: "chen\n" });
    expect(asText.body.expense.shares.map((s) => s.userId)).toEqual([chenId]);

    // Nobody picked: the preset's people, as before.
    const none = await api.call<QuickExpenseResult>(token, "POST", "/quick/expense", { preset: "Flat 4B · Everyone", amount: 90, title: "Milk", people: [] });
    expect(none.body.expense.shares).toHaveLength(3);

    const unknown = await api.call<{ message: string }>(token, "POST", "/quick/expense", { preset: "Flat 4B · Everyone", amount: 90, people: ["zed"] });
    expect(unknown.status).toBe(422);
    expect(unknown.body.message).toBe('Couldn\'t add the expense: "zed" is not in Flat 4B. Run the shortcut again.');
    const badPreset = await api.call<{ message: string }>(token, "POST", "/quick/people", { preset: "Nowhere" });
    expect(badPreset.body.message).toMatch(/^Couldn't load the people: /);
  });
});

describe("phone shortcut: forgiving input", () => {
  it("loads choices by POST too, and explains an empty choice", async () => {
    await flat();
    const { token } = await makeToken();
    const viaPost = await api.call<QuickOptions>(token, "POST", "/quick/options", {});
    expect(viaPost.body.labels).toEqual(["Flat 4B · Everyone"]);
    expect((await api.call<QuickOptions>(token, "POST", "/quick/options")).status).toBe(200);
    const empty = await api.call<{ message: string; error: { code: string } }>(token, "POST", "/quick/expense", { preset: "", amount: 10 });
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe("no_preset");
    expect(empty.body.message).toMatch(/^Couldn't add the expense: No space was picked\. In the shortcut, check the step before "Which space\?"/);
  });
});
