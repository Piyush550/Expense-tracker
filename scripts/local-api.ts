// Runs the same API and MCP server as the Netlify Functions, on http://127.0.0.1:8788, against
// a local PGlite database in .local-db/ and the Firebase Auth emulator. Used by `npm run dev:local`.
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { createApp } from "../server/app";
import { emulatorVerifier } from "../server/auth";
import { createMcpApp } from "../server/mcp";
import { dbFromPglite, migrate } from "./migrations";
import { ensureLocalTestAccount } from "./local-test-account";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-expense-tracker";
const pg = new PGlite(process.env.LOCAL_DB_DIR ?? ".local-db");
await migrate(pg);
await ensureLocalTestAccount();

const app = createApp({ db: () => dbFromPglite(pg), verifyToken: emulatorVerifier(projectId) });
const mcp = createMcpApp(app);
const fetch = (req: Request) => (new URL(req.url).pathname.startsWith("/mcp") ? mcp.fetch(req) : app.fetch(req));
serve({ fetch, port: 8788, hostname: "127.0.0.1" }, ({ port }) => {
  console.log(`Local API on http://127.0.0.1:${port}/api and MCP on /mcp (database: .local-db, auth: emulator for ${projectId})`);
});
