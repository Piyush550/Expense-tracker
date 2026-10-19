// The whole API as one Netlify Function, served at /api/*.
import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { createApp } from "../../server/app";
import { firebaseVerifier } from "../../server/auth";
import { dbFromPool, type Db } from "../../server/db";
import { firebaseConfig } from "../../shared/config";

// Created on first use and reused while this function instance stays warm.
let db: Db | undefined;

const app = createApp({
  db: () => (db ??= dbFromPool(getDatabase().pool)),
  verifyToken: firebaseVerifier(process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId),
});

export default (req: Request) => app.fetch(req);

export const config: Config = {
  path: "/api/*",
  // Per client IP: generous for a person using the app, a wall for a script hammering it.
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
