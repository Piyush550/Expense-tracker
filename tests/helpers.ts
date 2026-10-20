import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../server/app";
import type { AuthClaims } from "../server/auth";
import { unauthorized } from "../server/errors";
import { dbFromPglite, migrate } from "../scripts/migrations";

export interface Person {
  uid: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
}

/** A fresh database with the real migrations, and the real app with a fake token check. */
export async function setup() {
  const pg = new PGlite();
  await migrate(pg);
  const db = dbFromPglite(pg);
  const app = createApp({
    db: () => db,
    // Tests pass the claims themselves as the "token".
    verifyToken: async (token) => {
      try {
        const p = JSON.parse(decodeURIComponent(token)) as Person;
        return { uid: p.uid, email: p.email.toLowerCase(), emailVerified: p.emailVerified ?? true, name: p.name ?? null } satisfies AuthClaims;
      } catch {
        throw unauthorized();
      }
    },
  });

  /** `as` is a test sign-in (Person), a raw bearer token (string, e.g. a personal "et_" token), or nobody. */
  async function call<T = unknown>(as: Person | string | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (typeof as === "string") headers.authorization = `Bearer ${as}`;
    else if (as) headers.authorization = `Bearer ${encodeURIComponent(JSON.stringify(as))}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  return { pg, db, call, app };
}

export const person = (name: string): Person => ({ uid: `uid-${name}`, email: `${name}@example.com`, name });

export const newId = () => randomUUID();
