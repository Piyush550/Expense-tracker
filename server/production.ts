// The API as deployed: Netlify Database and Firebase sign-in. Shared by the /api and /mcp functions.
import { getDatabase } from "@netlify/database";
import { firebaseConfig } from "../shared/config";
import { createApp } from "./app";
import { firebaseVerifier } from "./auth";
import { dbFromPool, type Db } from "./db";

// Created on first use and reused while the function instance stays warm.
let db: Db | undefined;

export function productionApp() {
  return createApp({
    db: () => (db ??= dbFromPool(getDatabase().pool)),
    verifyToken: firebaseVerifier(process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId),
  });
}
