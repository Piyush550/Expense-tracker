// The MCP server for Claude and ChatGPT, at /mcp and /mcp/<key>. It runs the API in-process,
// signed in with the caller's personal key (see server/mcp.ts).
import type { Config } from "@netlify/functions";
import { createMcpApp } from "../../server/mcp";
import { productionApp } from "../../server/production";

const mcp = createMcpApp(productionApp());

export default (req: Request) => mcp.fetch(req);

export const config: Config = {
  path: ["/mcp", "/mcp/*"],
  // An assistant makes a handful of calls per question; this only stops runaway loops.
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
