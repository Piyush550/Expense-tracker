// The HTTP API. Every route below /api requires a verified Firebase sign-in, and every
// space-scoped route checks membership before touching data.
import { Hono, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Balances, Expense, Group, Me, MonthSummary, Person, Settlement, SpaceDetail } from "../shared/api";
import { activeMemberIds, assertUuid, requireMember, requireOwner } from "./access";
import type { VerifyToken } from "./auth";
import { pgCode, type Db, type Queryable } from "./db";
import { conflict, forbidden, HttpError, notFound, unauthorized } from "./errors";
import { findExpense, getSettlement, listExpenses, listSettlements, replaceShares, sharesFor } from "./expenses";
import { findGroup, listGroups, requireGroupOwner, setGroupMembers } from "./groups";
import { addEmailToSpace, addToSpace, ensureSpaceKeepsOwner, listSpaces, loadSpace } from "./spaces";
import { type Ctx, type Env, parse, readBody } from "./http";
import { memberNet, monthlySummary, spaceBalances } from "./ledger";
import { listContacts, requireContacts } from "./people";
import * as s from "./schemas";
import type { CreateExpense } from "./schemas";
import { mergeUsers, resolveUser } from "./users";

export interface AppDeps {
  db: () => Db;
  verifyToken: VerifyToken;
}

export function createApp({ db: getDb, verifyToken }: AppDeps) {
  const app = new Hono<Env>().basePath("/api");

  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });

  app.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: { code: "too_large", message: "Request body is too large." } }, 413),
    }),
  );

  app.use("*", async (c, next) => {
    if (["POST", "PATCH", "PUT"].includes(c.req.method) && !c.req.header("content-type")?.startsWith("application/json")) {
      throw new HttpError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.");
    }
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw unauthorized("Sign in to continue.");
    const claims = await verifyToken(token);
    const db = getDb();
    c.set("db", db);
    c.set("user", await resolveUser(db, claims));
    await next();
  });

  // Outsiders get 404 for anything under a space, before their input is even looked at.
  // Handlers check again inside their transactions, where they also need the role.
  const memberOnly = async (c: Ctx, next: Next) => {
    await requireMember(c.var.db, c.req.param("id") ?? "", c.var.user.id);
    await next();
  };
  app.use("/spaces/:id", memberOnly);
  app.use("/spaces/:id/*", memberOnly);

  // ── Me ────────────────────────────────────────────────────────────────────────────────
  app.get("/me", (c) => c.json(c.var.user));

  app.patch("/me", async (c) => {
    const { name } = await readBody(c, s.updateMe);
    await c.var.db.query("UPDATE users SET name = $2, updated_at = now() WHERE id = $1", [c.var.user.id, name]);
    return c.json({ ...c.var.user, name });
  });

  // People you already share a space or group with: the "add someone" dropdowns.
  app.get("/people", async (c) => c.json<Person[]>(await listContacts(c.var.db, c.var.user.id)));

  // ── Spaces ────────────────────────────────────────────────────────────────────────────
  app.get("/spaces", async (c) => c.json(await listSpaces(c.var.db, c.var.user.id)));

  // Anyone can make a space; they become its owner.
  app.post("/spaces", async (c) => {
    const body = await readBody(c, s.createSpace);
    const me = c.var.user;
    const detail = await c.var.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO spaces (name, kind, created_by) VALUES ($1, $2, $3) RETURNING id",
        [body.name, body.kind, me.id],
      );
      const spaceId = rows[0]!.id;
      await tx.query("INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'owner')", [spaceId, me.id]);
      await requireContacts(tx, me.id, body.memberIds);
      for (const userId of new Set(body.memberIds)) if (userId !== me.id) await addToSpace(tx, spaceId, userId);
      for (const email of new Set(body.memberEmails)) await addEmailToSpace(tx, spaceId, email);
      for (const groupId of new Set(body.groupIds)) {
        for (const p of (await findGroup(tx, groupId, me.id)).members) await addToSpace(tx, spaceId, p.id);
      }
      return loadSpace(tx, spaceId, "owner");
    });
    return c.json<SpaceDetail>(detail, 201);
  });

  app.get("/spaces/:id", async (c) => {
    const spaceId = c.req.param("id");
    const { role } = await requireMember(c.var.db, spaceId, c.var.user.id);
    return c.json(await loadSpace(c.var.db, spaceId, role));
  });

  app.patch("/spaces/:id", async (c) => {
    const spaceId = c.req.param("id");
    const body = await readBody(c, s.updateSpace);
    await requireOwner(c.var.db, spaceId, c.var.user.id);
    await c.var.db.query(
      `UPDATE spaces SET name = COALESCE($2, name), kind = COALESCE($3, kind),
              simplify_debts = COALESCE($4, simplify_debts), updated_at = now()
        WHERE id = $1`,
      [spaceId, body.name ?? null, body.kind ?? null, body.simplifyDebts ?? null],
    );
    return c.json(await loadSpace(c.var.db, spaceId, "owner"));
  });

  app.delete("/spaces/:id", async (c) => {
    const spaceId = c.req.param("id");
    await c.var.db.transaction(async (tx) => {
      await requireOwner(tx, spaceId, c.var.user.id);
      await tx.query("SELECT id FROM spaces WHERE id = $1 FOR UPDATE", [spaceId]);
      const { members } = await spaceBalances(tx, spaceId, true);
      if (members.some((m) => m.netPaise !== 0)) {
        throw conflict("unsettled_balances", "Settle up all balances before deleting the space.");
      }
      await tx.query("DELETE FROM spaces WHERE id = $1", [spaceId]);
    });
    return c.body(null, 204);
  });

  // ── Members (owners manage them) ──────────────────────────────────────────────────────
  app.post("/spaces/:id/members", async (c) => {
    const spaceId = c.req.param("id");
    const body = await readBody(c, s.addMembers);
    const me = c.var.user;
    const detail = await c.var.db.transaction(async (tx) => {
      await requireOwner(tx, spaceId, me.id);
      if ("userId" in body) {
        await requireContacts(tx, me.id, [body.userId]);
        if (!(await addToSpace(tx, spaceId, body.userId))) throw conflict("already_member", "That person is already in the space.");
      } else if ("email" in body) {
        if (!(await addEmailToSpace(tx, spaceId, body.email, body.name))) {
          throw conflict("already_member", "That person is already in the space.");
        }
      } else {
        let added = 0;
        for (const p of (await findGroup(tx, body.groupId, me.id)).members) if (await addToSpace(tx, spaceId, p.id)) added++;
        if (!added) throw conflict("already_member", "Everyone in that group is already in the space.");
      }
      return loadSpace(tx, spaceId, "owner");
    });
    return c.json(detail, 201);
  });

  app.patch("/spaces/:id/members/:userId", async (c) => {
    const spaceId = c.req.param("id");
    const userId = assertUuid(c.req.param("userId"), "That member");
    const { role: newRole } = await readBody(c, s.updateMember);
    const detail = await c.var.db.transaction(async (tx) => {
      await requireOwner(tx, spaceId, c.var.user.id);
      await tx.query("SELECT id FROM spaces WHERE id = $1 FOR UPDATE", [spaceId]);
      if (newRole === "member") await ensureSpaceKeepsOwner(tx, spaceId, userId);
      const { rows } = await tx.query(
        "UPDATE space_members SET role = $3 WHERE space_id = $1 AND user_id = $2 AND left_at IS NULL RETURNING user_id",
        [spaceId, userId, newRole],
      );
      if (!rows.length) throw notFound("That member");
      return loadSpace(tx, spaceId, "owner");
    });
    return c.json(detail);
  });

  app.delete("/spaces/:id/members/:userId", async (c) => {
    const spaceId = c.req.param("id");
    const userId = assertUuid(c.req.param("userId"), "That member");
    const me = c.var.user;
    await c.var.db.transaction(async (tx) => {
      const { role } = await requireMember(tx, spaceId, me.id);
      if (userId !== me.id && role !== "owner") throw forbidden("owner_only", "Only a space owner can remove other people.");
      // Serialize membership changes in this space so two removals cannot both pass the checks.
      await tx.query("SELECT id FROM spaces WHERE id = $1 FOR UPDATE", [spaceId]);
      const target = await tx.query(
        "SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2 AND left_at IS NULL",
        [spaceId, userId],
      );
      if (!target.rows[0]) throw notFound("That member");
      await ensureSpaceKeepsOwner(tx, spaceId, userId);
      if ((await memberNet(tx, spaceId, userId)) !== 0) {
        throw conflict("member_has_balance", "Settle up this person's balance before they leave the space.");
      }
      await tx.query("UPDATE space_members SET left_at = now(), role = 'member' WHERE space_id = $1 AND user_id = $2", [
        spaceId,
        userId,
      ]);
    });
    return c.body(null, 204);
  });

  // "This name is really that person": folds an imported or invited name into an account.
  app.post("/spaces/:id/members/:userId/merge", async (c) => {
    const spaceId = c.req.param("id");
    const placeholderId = assertUuid(c.req.param("userId"), "That member");
    const { intoUserId } = await readBody(c, s.mergeMember);
    const me = c.var.user;
    const detail = await c.var.db.transaction(async (tx) => {
      const { role } = await requireMember(tx, spaceId, me.id);
      if (intoUserId !== me.id && role !== "owner") {
        throw forbidden("owner_only", "Only a space owner can link a name to someone else's account.");
      }
      const { rows } = await tx.query<{ auth_uid: string | null; spaces: unknown; in_space: boolean }>(
        `SELECT u.auth_uid,
                (SELECT COUNT(*) FROM space_members WHERE user_id = u.id) AS spaces,
                EXISTS (SELECT 1 FROM space_members WHERE user_id = u.id AND space_id = $2) AS in_space
           FROM users u WHERE u.id = $1 FOR UPDATE`,
        [placeholderId, spaceId],
      );
      const p = rows[0];
      if (!p || !p.in_space) throw notFound("That member");
      if (p.auth_uid !== null) throw conflict("already_registered", "That person already has their own account.");
      if (Number(p.spaces) > 1) throw conflict("in_other_spaces", "That name is used in other spaces too, so it cannot be linked here.");
      const into = await tx.query<{ auth_uid: string | null }>(
        `SELECT u.auth_uid FROM users u JOIN space_members m ON m.user_id = u.id
          WHERE u.id = $1 AND m.space_id = $2 AND m.left_at IS NULL`,
        [intoUserId, spaceId],
      );
      if (!into.rows[0]?.auth_uid) throw new HttpError(422, "not_a_member", "Pick a signed-up member of this space.");
      await mergeUsers(tx, placeholderId, intoUserId);
      return loadSpace(tx, spaceId, role);
    });
    return c.json(detail);
  });

  // ── Balances ──────────────────────────────────────────────────────────────────────────
  // ?month=YYYY-MM limits to one month (recurring spaces); without it, everything.
  app.get("/spaces/:id/balances", async (c) => {
    const spaceId = c.req.param("id");
    const { month } = parse(s.listQuery, c.req.query());
    const { rows } = await c.var.db.query<{ simplify_debts: boolean }>("SELECT simplify_debts FROM spaces WHERE id = $1", [spaceId]);
    return c.json<Balances>(await spaceBalances(c.var.db, spaceId, rows[0]?.simplify_debts ?? true, month));
  });

  app.get("/spaces/:id/months", async (c) => c.json<MonthSummary[]>(await monthlySummary(c.var.db, c.req.param("id"))));

  // ── Expenses (any member) ─────────────────────────────────────────────────────────────
  app.get("/spaces/:id/expenses", async (c) => {
    const { month } = parse(s.listQuery, c.req.query());
    return c.json<Expense[]>(await listExpenses(c.var.db, c.req.param("id"), month));
  });

  // Creates one expense inside the caller's transaction. A repeated id (a retried request)
  // returns what was stored and never overwrites it.
  const createOne = async (tx: Queryable, spaceId: string, me: Me, body: CreateExpense, allowed: Set<string>) => {
    const shares = sharesFor(body.amountPaise, body.splitType, body.splits, body.id, body.payerId, allowed);
    const inserted = await tx.query(
      `INSERT INTO expenses (id, space_id, description, amount_paise, payer_id, split_type, spent_on, remarks, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [body.id, spaceId, body.description, body.amountPaise, body.payerId, body.splitType, body.spentOn, body.remarks, me.id],
    );
    if (!inserted.rows.length) {
      const existing = await findExpense(tx, body.id, me.id);
      if (existing && existing.spaceId === spaceId && existing.createdBy === me.id) return { expense: existing, created: false };
      throw conflict("id_taken", "That expense id is already used.");
    }
    await replaceShares(tx, body.id, shares);
    return { expense: (await findExpense(tx, body.id, me.id))!, created: true };
  };

  app.post("/spaces/:id/expenses", async (c) => {
    const spaceId = c.req.param("id");
    const body = await readBody(c, s.createExpense);
    const me = c.var.user;
    const result = await c.var.db.transaction(async (tx) => {
      await requireMember(tx, spaceId, me.id);
      return createOne(tx, spaceId, me, body, await activeMemberIds(tx, spaceId));
    });
    return c.json(result.expense, result.created ? 201 : 200);
  });

  // Bulk add: every expense is saved, or none is. A problem in any row is reported with its
  // index so the app can point at that row.
  app.post("/spaces/:id/expenses/bulk", async (c) => {
    const spaceId = c.req.param("id");
    const { expenses } = await readBody(c, s.bulkExpenses);
    const me = c.var.user;
    const saved = await c.var.db.transaction(async (tx) => {
      await requireMember(tx, spaceId, me.id);
      const allowed = await activeMemberIds(tx, spaceId);
      const out: Expense[] = [];
      for (const [index, body] of expenses.entries()) {
        try {
          out.push((await createOne(tx, spaceId, me, body, allowed)).expense);
        } catch (err) {
          if (err instanceof HttpError) {
            throw new HttpError(err.status, err.code, `Row ${index + 1}: ${err.message}`, { index });
          }
          throw err;
        }
      }
      return out;
    });
    return c.json<{ expenses: Expense[] }>({ expenses: saved }, 201);
  });

  app.patch("/expenses/:id", async (c) => {
    const expenseId = assertUuid(c.req.param("id"), "That expense");
    const body = await readBody(c, s.updateExpense);
    const me = c.var.user;
    const expense = await c.var.db.transaction(async (tx) => {
      const current = await findExpense(tx, expenseId, me.id, true);
      if (!current) throw notFound("That expense");
      if (current.version !== body.version) {
        throw conflict("version_conflict", "Someone else changed this expense. Reload it and try again.", current);
      }
      // People already on the expense may stay on it even if they have since left the space.
      const allowed = await activeMemberIds(tx, current.spaceId);
      allowed.add(current.payerId);
      current.shares.forEach((sh) => allowed.add(sh.userId));
      const shares = sharesFor(body.amountPaise, body.splitType, body.splits, expenseId, body.payerId, allowed);
      await tx.query(
        `UPDATE expenses SET description = $2, amount_paise = $3, payer_id = $4, split_type = $5, spent_on = $6,
                remarks = $7, version = version + 1, updated_by = $8, updated_at = now()
          WHERE id = $1`,
        [expenseId, body.description, body.amountPaise, body.payerId, body.splitType, body.spentOn, body.remarks, me.id],
      );
      await replaceShares(tx, expenseId, shares);
      return (await findExpense(tx, expenseId, me.id))!;
    });
    return c.json(expense);
  });

  app.delete("/expenses/:id", async (c) => {
    const expenseId = assertUuid(c.req.param("id"), "That expense");
    const me = c.var.user;
    const { rows } = await c.var.db.query(
      `UPDATE expenses e SET deleted_at = now(), deleted_by = $2, version = e.version + 1
         FROM space_members m
        WHERE e.id = $1 AND e.deleted_at IS NULL
          AND m.space_id = e.space_id AND m.user_id = $2 AND m.left_at IS NULL
        RETURNING e.id`,
      [expenseId, me.id],
    );
    if (!rows.length) throw notFound("That expense");
    return c.body(null, 204);
  });

  // ── Payments (settlements, any member) ────────────────────────────────────────────────
  app.get("/spaces/:id/settlements", async (c) => {
    const { month } = parse(s.listQuery, c.req.query());
    return c.json<Settlement[]>(await listSettlements(c.var.db, c.req.param("id"), month));
  });

  app.post("/spaces/:id/settlements", async (c) => {
    const spaceId = c.req.param("id");
    const body = await readBody(c, s.createSettlement);
    const me = c.var.user;
    const period = `${body.period ?? body.paidOn.slice(0, 7)}-01`;
    const result = await c.var.db.transaction(async (tx) => {
      await requireMember(tx, spaceId, me.id);
      const active = await activeMemberIds(tx, spaceId);
      if (!active.has(body.fromUserId) || !active.has(body.toUserId)) {
        throw new HttpError(422, "not_a_member", "Both people must be members of the space.");
      }
      const inserted = await tx.query(
        `INSERT INTO settlements (id, space_id, from_user_id, to_user_id, amount_paise, paid_on, period, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [body.id, spaceId, body.fromUserId, body.toUserId, body.amountPaise, body.paidOn, period, body.note, me.id],
      );
      const stored = await getSettlement(tx, body.id);
      if (!inserted.rows.length && !(stored && stored.spaceId === spaceId && stored.createdBy === me.id)) {
        throw conflict("id_taken", "That payment id is already used.");
      }
      return { settlement: stored!, created: inserted.rows.length > 0 };
    });
    return c.json(result.settlement, result.created ? 201 : 200);
  });

  app.delete("/settlements/:id", async (c) => {
    const settlementId = assertUuid(c.req.param("id"), "That payment");
    const me = c.var.user;
    const { rows } = await c.var.db.query(
      `UPDATE settlements t SET deleted_at = now(), deleted_by = $2
         FROM space_members m
        WHERE t.id = $1 AND t.deleted_at IS NULL
          AND m.space_id = t.space_id AND m.user_id = $2 AND m.left_at IS NULL
        RETURNING t.id`,
      [settlementId, me.id],
    );
    if (!rows.length) throw notFound("That payment");
    return c.body(null, 204);
  });

  // ── Groups (reusable lists of people, across spaces) ──────────────────────────────────
  app.get("/groups", async (c) => c.json<Group[]>(await listGroups(c.var.db, c.var.user.id)));

  app.post("/groups", async (c) => {
    const body = await readBody(c, s.createGroup);
    const me = c.var.user;
    const group = await c.var.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>("INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id", [body.name, me.id]);
      await setGroupMembers(tx, rows[0]!.id, me.id, body.memberEmails, body.memberIds);
      return findGroup(tx, rows[0]!.id, me.id);
    });
    return c.json(group, 201);
  });

  app.patch("/groups/:id", async (c) => {
    const groupId = assertUuid(c.req.param("id"), "That group");
    const body = await readBody(c, s.updateGroup);
    const me = c.var.user;
    const group = await c.var.db.transaction(async (tx) => {
      await requireGroupOwner(tx, groupId, me.id);
      if (body.name !== undefined) await tx.query("UPDATE groups SET name = $2, updated_at = now() WHERE id = $1", [groupId, body.name]);
      if (body.memberEmails !== undefined || body.memberIds !== undefined) {
        await setGroupMembers(tx, groupId, me.id, body.memberEmails ?? [], body.memberIds ?? []);
      }
      return findGroup(tx, groupId, me.id);
    });
    return c.json(group);
  });

  app.delete("/groups/:id", async (c) => {
    const groupId = assertUuid(c.req.param("id"), "That group");
    await requireGroupOwner(c.var.db, groupId, c.var.user.id);
    await c.var.db.query("DELETE FROM groups WHERE id = $1", [groupId]);
    return c.body(null, 204);
  });

  // ── Errors ────────────────────────────────────────────────────────────────────────────
  app.notFound((c) => c.json({ error: { code: "not_found", message: "No such API route." } }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    const code = pgCode(err);
    if (code === "23505") return c.json({ error: { code: "conflict", message: "That already exists. Reload and try again." } }, 409);
    if (code === "23503") return c.json({ error: { code: "conflict", message: "Something this refers to no longer exists." } }, 409);
    if (code === "40001" || code === "40P01") return c.json({ error: { code: "retry", message: "The server was busy. Try again." } }, 409);
    console.error("Unhandled API error", c.req.method, c.req.path, err);
    return c.json({ error: { code: "internal", message: "Something went wrong on our side." } }, 500);
  });

  return app;
}
