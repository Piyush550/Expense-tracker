// The HTTP API. Every route below /api requires a verified Firebase sign-in or a personal
// token (which cannot delete, merge people or manage keys). Every space-scoped route checks
// membership before touching data.
import { Hono, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApiToken, Balances, Expense, ExpensePage, Me, MonthSummary, NewApiToken, Person, QuickExpenseResult, QuickOptions, Settlement, SettlementPage, SpaceDetail } from "../shared/api";
import { activeMemberIds, assertUuid, requireMember, requireOwner } from "./access";
import type { VerifyToken } from "./auth";
import { pgCode, type Db, type Queryable } from "./db";
import { conflict, forbidden, HttpError, notFound, unauthorized } from "./errors";
import { findExpense, getSettlement, listExpenses, listSettlements, pageExpenses, pageSettlements, replaceShares, sharesFor } from "./expenses";
import { createSpaceGroup, findSpaceGroup, listSpaceGroups, loadQuickActions, saveQuickActions, setSpaceGroupMembers } from "./groups";
import { addEmailToSpace, addToSpace, ensureSpaceKeepsOwner, listSpaces, loadSpace } from "./spaces";
import { type Ctx, type Env, parse, readBody } from "./http";
import { memberNet, monthlySummary, spaceBalances } from "./ledger";
import { listContacts, pageRegisteredDirectory, registeredDirectory, requireContacts, requireRegistered } from "./people";
import * as s from "./schemas";
import type { CreateExpense } from "./schemas";
import { mergeUsers, resolveUser } from "./users";
import { findPreset, peopleChoices, pickedPeople, quickAmount, quickDate, quickMessage, quickPresets } from "./quick";
import { createToken, deleteToken, listTokens, regenerateToken, revokeToken, TOKEN_PREFIX, tokenMayCall, updateToken, userForToken } from "./tokens";
import { randomUUID } from "node:crypto";

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
    // A body must be JSON; a body-less POST (regenerate, revoke) is fine.
    const hasBody = c.req.raw.body !== null && c.req.header("content-length") !== "0";
    if (["POST", "PATCH", "PUT"].includes(c.req.method) && hasBody && !c.req.header("content-type")?.startsWith("application/json")) {
      throw new HttpError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.");
    }
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw unauthorized("Sign in to continue.");
    const db = getDb();
    c.set("db", db);
    if (token.startsWith(TOKEN_PREFIX)) {
      // A personal token: signs in as the user who made it, for everything but destructive routes.
      const user = await userForToken(db, token);
      if (!user) throw unauthorized("This key is not valid any more. Create a new one in the app under Settings → iPhone & AI apps.");
      if (!tokenMayCall(c.req.method, c.req.path)) {
        throw forbidden("token_scope", "A key can't delete, merge people or manage keys. Do that in the app.");
      }
      c.set("via", "token");
      c.set("user", user);
    } else {
      c.set("via", "session");
      c.set("user", await resolveUser(db, await verifyToken(token)));
    }
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

  // ── Personal tokens (managed only from a normal sign-in) ──────────────────────────────
  app.use("/tokens", async (c, next) => {
    if (c.var.via !== "session") throw forbidden("token_scope", "Sign in to the app to manage keys.");
    await next();
  });
  app.use("/tokens/*", async (c, next) => {
    if (c.var.via !== "session") throw forbidden("token_scope", "Sign in to the app to manage keys.");
    await next();
  });

  app.get("/tokens", async (c) => c.json<ApiToken[]>(await listTokens(c.var.db, c.var.user.id)));

  app.post("/tokens", async (c) => {
    const { name, lifetimeDays } = await readBody(c, s.createToken);
    const created = await c.var.db.transaction((tx) => createToken(tx, c.var.user.id, name, lifetimeDays));
    return c.json<NewApiToken>(created, 201);
  });

  app.post("/tokens/:tokenId/regenerate", async (c) => {
    const id = assertUuid(c.req.param("tokenId"), "That token");
    return c.json<NewApiToken>(await c.var.db.transaction((tx) => regenerateToken(tx, c.var.user.id, id)));
  });

  app.patch("/tokens/:tokenId", async (c) => {
    const id = assertUuid(c.req.param("tokenId"), "That token");
    const patch = await readBody(c, s.updateToken);
    return c.json<ApiToken>(await c.var.db.transaction((tx) => updateToken(tx, c.var.user.id, id, patch)));
  });

  app.post("/tokens/:tokenId/revoke", async (c) => {
    const id = assertUuid(c.req.param("tokenId"), "That token");
    return c.json<ApiToken>(await revokeToken(c.var.db, c.var.user.id, id));
  });

  app.delete("/tokens/:tokenId", async (c) => {
    const id = assertUuid(c.req.param("tokenId"), "That token");
    await deleteToken(c.var.db, c.var.user.id, id);
    return c.body(null, 204);
  });

  // ── Phone shortcut: presets and quick equal-split add ─────────────────────────────────
  // GET or POST: a GET that carries a body (an easy Shortcuts slip) crashes in Netlify's
  // runtime before reaching this code, while a POST with or without a body always works.
  const quickOptions = async (c: Ctx) => {
    const presets = await quickPresets(c.var.db, c.var.user);
    return c.json<QuickOptions>({ labels: presets.map((p) => p.label), presets });
  };
  app.get("/quick/options", quickOptions);
  app.post("/quick/options", quickOptions);

  // "Who shared it?": the names to tick for the chosen preset's space, as a plain JSON list so
  // the shortcut can pass the reply straight to Choose from List. POST so the preset label
  // (spaces, "·") travels in the body rather than the URL.
  app.post("/quick/people", async (c) => {
    const { preset: wanted } = await readBody(c, s.quickPeople);
    const presets = await quickPresets(c.var.db, c.var.user);
    return c.json<string[]>(peopleChoices(presets, findPreset(presets, wanted)).map((p) => p.label));
  });

  app.post("/quick/expense", async (c) => {
    const body = await readBody(c, s.quickExpense);
    const me = c.var.user;
    const presets = await quickPresets(c.var.db, me);
    const preset = findPreset(presets, body.preset);
    const people = pickedPeople(presets, preset, body.people) ?? preset.people;
    const amountPaise = quickAmount(body.amount);
    const title = (body.title?.trim() || "Expense").slice(0, 100);
    const spentOn = quickDate(body.date);
    const result = await c.var.db.transaction(async (tx) => {
      await requireMember(tx, preset.spaceId, me.id);
      return createOne(tx, preset.spaceId, me, {
        id: body.requestId ?? randomUUID(),
        description: title,
        amountPaise,
        payerId: me.id,
        splitType: "equal",
        spentOn,
        remarks: "",
        splits: people.map((p) => ({ userId: p.id })),
      }, await activeMemberIds(tx, preset.spaceId));
    });
    const net = await memberNet(c.var.db, preset.spaceId, me.id);
    return c.json<QuickExpenseResult>({ message: quickMessage(amountPaise, title, preset, net, people), expense: result.expense }, result.created ? 201 : 200);
  });

  // ── Me ────────────────────────────────────────────────────────────────────────────────
  app.get("/me", (c) => c.json(c.var.user));

  app.patch("/me", async (c) => {
    const { name } = await readBody(c, s.updateMe);
    await c.var.db.query("UPDATE users SET name = $2, updated_at = now() WHERE id = $1", [c.var.user.id, name]);
    return c.json({ ...c.var.user, name });
  });

  // People you already share a space or group with: the "add someone" dropdowns.
  app.get("/people", async (c) => c.json<Person[]>(await listContacts(c.var.db, c.var.user.id)));
  app.get("/people/directory", async (c) => c.json<Person[]>(await registeredDirectory(c.var.db, c.var.user.id)));
  app.get("/people/directory/page", async (c) => c.json(await pageRegisteredDirectory(c.var.db, parse(s.directoryPageQuery, c.req.query()))));

  // ── Spaces ────────────────────────────────────────────────────────────────────────────
  app.get("/spaces", async (c) => c.json(await listSpaces(c.var.db, c.var.user.id)));

  // Anyone can make a space; they become its owner.
  app.post("/spaces", async (c) => {
    const body = await readBody(c, s.createSpace);
    const me = c.var.user;
    const result = await c.var.db.transaction(async (tx) => {
      const spaceId = body.id ?? randomUUID();
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO spaces (id, name, kind, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id",
        [spaceId, body.name, body.kind, me.id],
      );
      if (!rows.length) {
        const existing = await tx.query<{ created_by: string }>("SELECT created_by FROM spaces WHERE id = $1", [spaceId]);
        if (existing.rows[0]?.created_by !== me.id) throw conflict("id_taken", "That space id is already used.");
        const { role } = await requireMember(tx, spaceId, me.id);
        return { detail: await loadSpace(tx, spaceId, role), created: false };
      }
      await tx.query("INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'owner')", [spaceId, me.id]);
      await requireContacts(tx, me.id, body.memberIds);
      await requireRegistered(tx, body.directoryIds);
      for (const userId of new Set(body.memberIds)) if (userId !== me.id) await addToSpace(tx, spaceId, userId);
      for (const userId of new Set(body.directoryIds)) if (userId !== me.id) await addToSpace(tx, spaceId, userId);
      for (const email of new Set(body.memberEmails)) await addEmailToSpace(tx, spaceId, email);
      for (const invite of body.memberInvites) await addEmailToSpace(tx, spaceId, invite.email, invite.name);
      for (const group of body.initialGroups) await createSpaceGroup(tx, spaceId, me.id, group);
      if (body.quickGroupIds.length) await saveQuickActions(tx, spaceId, { mode: "custom", groupIds: body.quickGroupIds });
      return { detail: await loadSpace(tx, spaceId, "owner"), created: true };
    });
    return c.json<SpaceDetail>(result.detail, result.created ? 201 : 200);
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
      if ("memberIds" in body) {
        await requireContacts(tx, me.id, body.memberIds);
        await requireRegistered(tx, body.directoryIds);
        let added = 0;
        for (const userId of new Set([...body.memberIds, ...body.directoryIds])) if (await addToSpace(tx, spaceId, userId)) added++;
        for (const invite of body.memberInvites) if (await addEmailToSpace(tx, spaceId, invite.email, invite.name)) added++;
        if (!added) throw conflict("already_member", "Those people are already in the space.");
      } else if ("directoryUserId" in body) {
        await requireRegistered(tx, [body.directoryUserId]);
        if (!(await addToSpace(tx, spaceId, body.directoryUserId))) throw conflict("already_member", "That person is already in the space.");
      } else if ("userId" in body) {
        await requireContacts(tx, me.id, [body.userId]);
        if (!(await addToSpace(tx, spaceId, body.userId))) throw conflict("already_member", "That person is already in the space.");
      } else if ("email" in body) {
        if (!(await addEmailToSpace(tx, spaceId, body.email, body.name))) {
          throw conflict("already_member", "That person is already in the space.");
        }
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
  // One filtered page plus exact totals (the AI-app listing). Every filter and the paging run in the database.
  app.get("/spaces/:id/expenses/page", async (c) =>
    c.json<ExpensePage>(await pageExpenses(c.var.db, c.req.param("id"), parse(s.expensePageQuery, c.req.query()))),
  );

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

  app.get("/expenses/:id", async (c) => {
    const expense = await findExpense(c.var.db, assertUuid(c.req.param("id"), "That expense"), c.var.user.id);
    if (!expense) throw notFound("That expense");
    return c.json<Expense>(expense);
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
  app.get("/spaces/:id/settlements/page", async (c) =>
    c.json<SettlementPage>(await pageSettlements(c.var.db, c.req.param("id"), parse(s.settlementPageQuery, c.req.query()))),
  );

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

  // ── Groups belonging to a space and shared shortcuts ─────────────────────────────
  app.get("/spaces/:id/groups", async (c) => c.json(await listSpaceGroups(c.var.db, c.req.param("id"), c.var.user.id)));

  app.post("/spaces/:id/groups", async (c) => {
    const spaceId = c.req.param("id");
    const body = await readBody(c, s.spaceGroup);
    const group = await c.var.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM spaces WHERE id = $1 FOR UPDATE", [spaceId]);
      await requireOwner(tx, spaceId, c.var.user.id);
      const groupId = await createSpaceGroup(tx, spaceId, c.var.user.id, body);
      return findSpaceGroup(tx, spaceId, groupId, c.var.user.id);
    });
    return c.json(group, 201);
  });

  app.patch("/spaces/:id/groups/:groupId", async (c) => {
    const spaceId = c.req.param("id");
    const groupId = assertUuid(c.req.param("groupId"), "That group");
    const body = await readBody(c, s.updateSpaceGroup);
    const group = await c.var.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM spaces WHERE id = $1 FOR UPDATE", [spaceId]);
      await requireOwner(tx, spaceId, c.var.user.id);
      await findSpaceGroup(tx, spaceId, groupId, c.var.user.id);
      await tx.query("UPDATE groups SET name = COALESCE($2, name), updated_at = now() WHERE id = $1 AND space_id = $3", [groupId, body.name ?? null, spaceId]);
      if (body.memberIds) await setSpaceGroupMembers(tx, spaceId, groupId, body.memberIds);
      return findSpaceGroup(tx, spaceId, groupId, c.var.user.id);
    });
    return c.json(group);
  });

  app.delete("/spaces/:id/groups/:groupId", async (c) => {
    const spaceId = c.req.param("id");
    const groupId = assertUuid(c.req.param("groupId"), "That group");
    await c.var.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM spaces WHERE id = $1 FOR UPDATE", [spaceId]);
      await requireOwner(tx, spaceId, c.var.user.id);
      await findSpaceGroup(tx, spaceId, groupId, c.var.user.id);
      await tx.query("DELETE FROM groups WHERE id = $1 AND space_id = $2", [groupId, spaceId]);
    });
    return c.body(null, 204);
  });

  app.get("/spaces/:id/quick-actions", async (c) => c.json(await loadQuickActions(c.var.db, c.req.param("id"))));
  app.put("/spaces/:id/quick-actions", async (c) => {
    const spaceId = c.req.param("id");
    const body = await readBody(c, s.quickActions);
    const config = await c.var.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM spaces WHERE id = $1 FOR UPDATE", [spaceId]);
      await requireOwner(tx, spaceId, c.var.user.id);
      await saveQuickActions(tx, spaceId, body);
      return loadQuickActions(tx, spaceId);
    });
    return c.json(config);
  });

  // ── Errors ────────────────────────────────────────────────────────────────────────────
  // Every error reply is { error: { code, message } }. The phone shortcut's last step shows the
  // reply's top-level `message`, so its two routes also get a readable one: without it a failed
  // add would pop up a blank notification and look like nothing happened.
  const fail = (c: Ctx, status: HttpError["status"], code: string, message: string, details?: unknown) => {
    const body: Record<string, unknown> = { error: { code, message, details } };
    const path = c.req.path.replace(/\/+$/, "");
    if (path === "/api/quick/expense") body.message = `Couldn't add the expense: ${message}`;
    else if (path === "/api/quick/options") body.message = `Couldn't load your choices: ${message}`;
    else if (path === "/api/quick/people") body.message = `Couldn't load the people: ${message}`;
    return c.json(body, status);
  };

  app.notFound((c) => fail(c as Ctx, 404, "not_found", "No such API route."));

  app.onError((err, c) => {
    const ctx = c as Ctx;
    if (err instanceof HttpError) return fail(ctx, err.status, err.code, err.message, err.details);
    const code = pgCode(err);
    if (code === "23505") return fail(ctx, 409, "conflict", "That already exists. Reload and try again.");
    if (code === "23503") return fail(ctx, 409, "conflict", "Something this refers to no longer exists.");
    if (code === "40001" || code === "40P01") return fail(ctx, 409, "retry", "The server was busy. Try again.");
    console.error("Unhandled API error", c.req.method, c.req.path, err);
    return fail(ctx, 500, "internal", "Something went wrong on our side.");
  });

  return app;
}
