// The HTTP API. Every route below /api requires a verified Firebase sign-in, and every
// group-scoped route checks membership before touching data.
import { Hono, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Balances, Expense, GroupDetail, Settlement } from "../shared/api";
import { activeMemberIds, assertUuid, requireMember, requireOwner } from "./access";
import type { VerifyToken } from "./auth";
import { pgCode, type Db } from "./db";
import { conflict, forbidden, HttpError, notFound, unauthorized } from "./errors";
import { findExpense, getSettlement, listExpenses, listSettlements, replaceShares, sharesFor } from "./expenses";
import { addMemberByEmail, ensureGroupKeepsOwner, listGroups, loadGroup } from "./groups";
import { type Ctx, type Env, parse, readBody } from "./http";
import { groupBalances, memberNet } from "./ledger";
import * as s from "./schemas";
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

  // Outsiders get 404 for anything under a group, before their input is even looked at.
  // Handlers check again inside their transactions, where they also need the role.
  const memberOnly = async (c: Ctx, next: Next) => {
    await requireMember(c.var.db, c.req.param("id") ?? "", c.var.user.id);
    await next();
  };
  app.use("/groups/:id", memberOnly);
  app.use("/groups/:id/*", memberOnly);

  // ── Me ────────────────────────────────────────────────────────────────────────────────
  app.get("/me", (c) => c.json(c.var.user));

  app.patch("/me", async (c) => {
    const { name } = await readBody(c, s.updateMe);
    await c.var.db.query("UPDATE users SET name = $2, updated_at = now() WHERE id = $1", [c.var.user.id, name]);
    return c.json({ ...c.var.user, name });
  });

  // ── Groups ────────────────────────────────────────────────────────────────────────────
  app.get("/groups", async (c) => c.json(await listGroups(c.var.db, c.var.user.id)));

  app.post("/groups", async (c) => {
    const body = await readBody(c, s.createGroup);
    const me = c.var.user;
    const detail = await c.var.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id",
        [body.name, me.id],
      );
      const groupId = rows[0]!.id;
      await tx.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')", [groupId, me.id]);
      for (const email of new Set(body.memberEmails)) {
        if (email !== me.email) await addMemberByEmail(tx, groupId, email);
      }
      return loadGroup(tx, groupId, "owner");
    });
    return c.json<GroupDetail>(detail, 201);
  });

  app.get("/groups/:id", async (c) => {
    const groupId = c.req.param("id");
    const { role } = await requireMember(c.var.db, groupId, c.var.user.id);
    return c.json(await loadGroup(c.var.db, groupId, role));
  });

  app.patch("/groups/:id", async (c) => {
    const groupId = c.req.param("id");
    const body = await readBody(c, s.updateGroup);
    const { role } = await requireMember(c.var.db, groupId, c.var.user.id);
    await c.var.db.query(
      `UPDATE groups SET name = COALESCE($2, name), simplify_debts = COALESCE($3, simplify_debts), updated_at = now()
        WHERE id = $1`,
      [groupId, body.name ?? null, body.simplifyDebts ?? null],
    );
    return c.json(await loadGroup(c.var.db, groupId, role));
  });

  app.delete("/groups/:id", async (c) => {
    const groupId = c.req.param("id");
    await c.var.db.transaction(async (tx) => {
      await requireOwner(tx, groupId, c.var.user.id);
      await tx.query("SELECT id FROM groups WHERE id = $1 FOR UPDATE", [groupId]);
      const { members } = await groupBalances(tx, groupId, true);
      if (members.some((m) => m.netPaise !== 0)) {
        throw conflict("unsettled_balances", "Settle up all balances before deleting the group.");
      }
      await tx.query("DELETE FROM groups WHERE id = $1", [groupId]);
    });
    return c.body(null, 204);
  });

  // ── Members ───────────────────────────────────────────────────────────────────────────
  app.post("/groups/:id/members", async (c) => {
    const groupId = c.req.param("id");
    const body = await readBody(c, s.addMember);
    const detail = await c.var.db.transaction(async (tx) => {
      const { role } = await requireMember(tx, groupId, c.var.user.id);
      if (!(await addMemberByEmail(tx, groupId, body.email, body.name))) {
        throw conflict("already_member", "That person is already in the group.");
      }
      return loadGroup(tx, groupId, role);
    });
    return c.json(detail, 201);
  });

  app.patch("/groups/:id/members/:userId", async (c) => {
    const groupId = c.req.param("id");
    const userId = assertUuid(c.req.param("userId"), "That member");
    const { role: newRole } = await readBody(c, s.updateMember);
    const detail = await c.var.db.transaction(async (tx) => {
      await requireOwner(tx, groupId, c.var.user.id);
      await tx.query("SELECT id FROM groups WHERE id = $1 FOR UPDATE", [groupId]);
      if (newRole === "member") await ensureGroupKeepsOwner(tx, groupId, userId);
      const { rows } = await tx.query(
        "UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL RETURNING user_id",
        [groupId, userId, newRole],
      );
      if (!rows.length) throw notFound("That member");
      return loadGroup(tx, groupId, "owner");
    });
    return c.json(detail);
  });

  app.delete("/groups/:id/members/:userId", async (c) => {
    const groupId = c.req.param("id");
    const userId = assertUuid(c.req.param("userId"), "That member");
    const me = c.var.user;
    await c.var.db.transaction(async (tx) => {
      const { role } = await requireMember(tx, groupId, me.id);
      if (userId !== me.id && role !== "owner") throw forbidden("owner_only", "Only a group owner can remove other people.");
      // Serialize membership changes in this group so two removals cannot both pass the checks.
      await tx.query("SELECT id FROM groups WHERE id = $1 FOR UPDATE", [groupId]);
      const target = await tx.query<{ role: string }>(
        "SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL",
        [groupId, userId],
      );
      if (!target.rows[0]) throw notFound("That member");
      await ensureGroupKeepsOwner(tx, groupId, userId);
      if ((await memberNet(tx, groupId, userId)) !== 0) {
        throw conflict("member_has_balance", "Settle up this person's balance before they leave the group.");
      }
      await tx.query("UPDATE group_members SET left_at = now(), role = 'member' WHERE group_id = $1 AND user_id = $2", [
        groupId,
        userId,
      ]);
    });
    return c.body(null, 204);
  });

  // "This placeholder is really that person": folds an imported or invited name into an account.
  app.post("/groups/:id/members/:userId/merge", async (c) => {
    const groupId = c.req.param("id");
    const placeholderId = assertUuid(c.req.param("userId"), "That member");
    const { intoUserId } = await readBody(c, s.mergeMember);
    const me = c.var.user;
    const detail = await c.var.db.transaction(async (tx) => {
      const { role } = await requireMember(tx, groupId, me.id);
      if (intoUserId !== me.id && role !== "owner") {
        throw forbidden("owner_only", "Only a group owner can link a name to someone else's account.");
      }
      const { rows } = await tx.query<{ auth_uid: string | null; groups: unknown; in_group: boolean }>(
        `SELECT u.auth_uid,
                (SELECT COUNT(*) FROM group_members WHERE user_id = u.id) AS groups,
                EXISTS (SELECT 1 FROM group_members WHERE user_id = u.id AND group_id = $2) AS in_group
           FROM users u WHERE u.id = $1 FOR UPDATE`,
        [placeholderId, groupId],
      );
      const p = rows[0];
      if (!p || !p.in_group) throw notFound("That member");
      if (p.auth_uid !== null) throw conflict("already_registered", "That person already has their own account.");
      if (Number(p.groups) > 1) throw conflict("in_other_groups", "That name is used in other groups too, so it cannot be linked here.");
      const into = await tx.query<{ auth_uid: string | null }>(
        `SELECT u.auth_uid FROM users u JOIN group_members m ON m.user_id = u.id
          WHERE u.id = $1 AND m.group_id = $2 AND m.left_at IS NULL`,
        [intoUserId, groupId],
      );
      if (!into.rows[0]?.auth_uid) throw new HttpError(422, "not_a_member", "Pick a signed-up member of this group.");
      await mergeUsers(tx, placeholderId, intoUserId);
      return loadGroup(tx, groupId, role);
    });
    return c.json(detail);
  });

  // ── Balances ──────────────────────────────────────────────────────────────────────────
  app.get("/groups/:id/balances", async (c) => {
    const groupId = c.req.param("id");
    await requireMember(c.var.db, groupId, c.var.user.id);
    const { rows } = await c.var.db.query<{ simplify_debts: boolean }>("SELECT simplify_debts FROM groups WHERE id = $1", [groupId]);
    return c.json<Balances>(await groupBalances(c.var.db, groupId, rows[0]?.simplify_debts ?? true));
  });

  // ── Expenses ──────────────────────────────────────────────────────────────────────────
  app.get("/groups/:id/expenses", async (c) => {
    const groupId = c.req.param("id");
    const { month } = parse(s.listQuery, c.req.query());
    await requireMember(c.var.db, groupId, c.var.user.id);
    return c.json<Expense[]>(await listExpenses(c.var.db, groupId, month));
  });

  app.post("/groups/:id/expenses", async (c) => {
    const groupId = c.req.param("id");
    const body = await readBody(c, s.createExpense);
    const me = c.var.user;
    const result = await c.var.db.transaction(async (tx) => {
      await requireMember(tx, groupId, me.id);
      const shares = sharesFor(body.amountPaise, body.splitType, body.splits, body.id, body.payerId, await activeMemberIds(tx, groupId));
      const inserted = await tx.query(
        `INSERT INTO expenses (id, group_id, description, amount_paise, payer_id, split_type, spent_on, remarks, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [body.id, groupId, body.description, body.amountPaise, body.payerId, body.splitType, body.spentOn, body.remarks, me.id],
      );
      if (!inserted.rows.length) {
        // Same id again: a retried request. Return what was stored; never overwrite.
        const existing = await findExpense(tx, body.id, me.id);
        if (existing && existing.groupId === groupId && existing.createdBy === me.id) return { expense: existing, created: false };
        throw conflict("id_taken", "That expense id is already used.");
      }
      await replaceShares(tx, body.id, shares);
      return { expense: (await findExpense(tx, body.id, me.id))!, created: true };
    });
    return c.json(result.expense, result.created ? 201 : 200);
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
      // People already on the expense may stay on it even if they have since left the group.
      const allowed = await activeMemberIds(tx, current.groupId);
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
         FROM group_members m
        WHERE e.id = $1 AND e.deleted_at IS NULL
          AND m.group_id = e.group_id AND m.user_id = $2 AND m.left_at IS NULL
        RETURNING e.id`,
      [expenseId, me.id],
    );
    if (!rows.length) throw notFound("That expense");
    return c.body(null, 204);
  });

  // ── Payments (settlements) ────────────────────────────────────────────────────────────
  app.get("/groups/:id/settlements", async (c) => {
    const groupId = c.req.param("id");
    const { month } = parse(s.listQuery, c.req.query());
    await requireMember(c.var.db, groupId, c.var.user.id);
    return c.json<Settlement[]>(await listSettlements(c.var.db, groupId, month));
  });

  app.post("/groups/:id/settlements", async (c) => {
    const groupId = c.req.param("id");
    const body = await readBody(c, s.createSettlement);
    const me = c.var.user;
    const result = await c.var.db.transaction(async (tx) => {
      await requireMember(tx, groupId, me.id);
      const active = await activeMemberIds(tx, groupId);
      if (!active.has(body.fromUserId) || !active.has(body.toUserId)) {
        throw new HttpError(422, "not_a_member", "Both people must be members of the group.");
      }
      const inserted = await tx.query(
        `INSERT INTO settlements (id, group_id, from_user_id, to_user_id, amount_paise, paid_on, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [body.id, groupId, body.fromUserId, body.toUserId, body.amountPaise, body.paidOn, body.note, me.id],
      );
      const stored = await getSettlement(tx, body.id);
      if (!inserted.rows.length && !(stored && stored.groupId === groupId && stored.createdBy === me.id)) {
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
         FROM group_members m
        WHERE t.id = $1 AND t.deleted_at IS NULL
          AND m.group_id = t.group_id AND m.user_id = $2 AND m.left_at IS NULL
        RETURNING t.id`,
      [settlementId, me.id],
    );
    if (!rows.length) throw notFound("That payment");
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
