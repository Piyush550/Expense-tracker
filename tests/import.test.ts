import { describe, expect, it } from "vitest";
import { importLedger, readLedger, uuidV5 } from "../scripts/legacy-import";
import { setup } from "./helpers";

// Shaped like an export of the old app's `ledger` node.
const exportJson = {
  ledger: {
    users: {
      u1: { name: "Asha", email: "Asha@Example.com", createdAt: 1 },
      u2: { name: "Bala", email: "bala@example.com", createdAt: 2 },
    },
    members: {
      m1: { name: "Asha (old list)", claimedBy: "u1" },
      m2: { name: "Chen" },
    },
    expenses: {
      e1: { date: "2026-08-10", name: "Dinner", paise: 30000, payer: "u1", people: { u1: true, u2: true, m2: true }, createdAt: 1754800000000 },
      e2: { date: "2026-08-12", name: "Cab", paise: 6000, payer: "m1", people: { u2: true, m1: true } },
      e3: { date: "2026-09-01", name: "Snacks", paise: 1000, payer: "u2", people: { u2: true, m2: true } },
      bad: { date: "someday", name: "Broken", paise: 100, payer: "u1", people: { u1: true } },
    },
    // August was fully settled in the old app: Bala paid Asha 130, Chen paid Asha 100.
    settled: { "2026-08": { u2_u1_13000: true, m2_u1_10000: true } },
    groups: { g1: { name: "Preset", members: { u1: true } } },
  },
};

describe("Firebase import", () => {
  it("rebuilds the ledger with the same balances and is safe to re-run", async () => {
    const { db, call } = await setup();
    // Asha already signed in to the new app before the import ran.
    await call({ uid: "u1", email: "asha@example.com", name: "Asha" }, "GET", "/me");

    const ledger = readLedger(exportJson);
    const dry = await importLedger(db, ledger, { spaceName: "Old ledger", dryRun: true });
    expect(dry.expenses.imported).toBe(3);
    expect((await db.query("SELECT 1 FROM expenses")).rows).toHaveLength(0);

    const first = await importLedger(db, ledger, { spaceName: "Old ledger" });
    expect(first.expenses).toEqual({ imported: 3, alreadyThere: 0 });
    expect(first.payments).toEqual({ imported: 2, alreadyThere: 0 });
    expect(first.skipped).toEqual([expect.stringContaining("bad date")]);
    expect(first.groups).toBe(1);
    // Only September is still open: Chen owes Bala ₹5.
    expect(first.balances).toEqual([
      { name: "Bala", netPaise: 500 },
      { name: "Chen", netPaise: -500 },
    ]);

    const again = await importLedger(db, ledger, { spaceName: "Old ledger" });
    expect(again.expenses).toEqual({ imported: 0, alreadyThere: 3 });
    expect(again.payments).toEqual({ imported: 0, alreadyThere: 2 });
    expect(again.balances).toEqual(first.balances);

    // The claimed old name became Asha's account; the existing row was reused, not duplicated.
    const users = await db.query<{ name: string; auth_uid: string | null }>("SELECT name, auth_uid FROM users ORDER BY name");
    expect(users.rows).toEqual([
      { name: "Asha", auth_uid: "u1" },
      { name: "Bala", auth_uid: "u2" },
      { name: "Chen", auth_uid: null },
    ]);

    // Bala signs in with the same Firebase uid and sees the group straight away.
    const spaces = await call<{ id: string; kind: string; myBalancePaise: number }[]>({ uid: "u2", email: "bala@example.com" }, "GET", "/spaces");
    expect(spaces.body).toEqual([expect.objectContaining({ id: first.spaceId, kind: "recurring", myBalancePaise: 500 })]);
    // August is settled by the imported ticks, month by month as in the old app.
    const aug = await call<{ transfers: unknown[] }>({ uid: "u2", email: "bala@example.com" }, "GET", `/spaces/${first.spaceId}/balances?month=2026-08`);
    expect(aug.body.transfers).toEqual([]);
    // The optional "Preset" quick-pick list belongs only to the imported space.
    const groups = await call<{ name: string }[]>({ uid: "u1", email: "asha@example.com" }, "GET", `/spaces/${first.spaceId}/groups`);
    expect(groups.body.map((g) => g.name)).toEqual(["Preset"]);
  });

  it("produces stable, valid v5 UUIDs", () => {
    const a = uuidV5("expense:abc");
    expect(a).toBe(uuidV5("expense:abc"));
    expect(a).not.toBe(uuidV5("expense:abd"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
