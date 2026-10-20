import type { Context } from "hono";
import type { z } from "zod";
import type { Me } from "../shared/api";
import type { Db } from "./db";
import { badRequest, HttpError } from "./errors";

/** `via`: how the caller signed in. "token" (a personal token) may only use a few routes. */
export type Env = { Variables: { user: Me; db: Db; via: "session" | "token" } };
export type Ctx = Context<Env>;

export async function readBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Send a JSON body.");
  }
  return parse(schema, raw);
}

export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = issues[0];
    throw new HttpError(422, "validation_failed", first ? `${first.path || "body"}: ${first.message}` : "Invalid input.", issues);
  }
  return result.data;
}
