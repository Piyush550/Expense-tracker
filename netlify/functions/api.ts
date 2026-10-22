// The whole API as one Netlify Function, served at /api/*.
import type { Config } from "@netlify/functions";
import { productionApp } from "../../server/production";

const app = productionApp();

export default (req: Request) => app.fetch(req);

export const config: Config = {
  path: "/api/*",
  // Per client IP: generous for a person using the app, a wall for a script hammering it.
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
