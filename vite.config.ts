import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `npm run dev:local` (mode "offline") proxies /api and /mcp to scripts/local-api.ts.
// `netlify dev` routes them to the Netlify Functions themselves, so no proxy is needed there.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: mode === "offline" ? { proxy: { "/api": "http://127.0.0.1:8788", "/mcp": "http://127.0.0.1:8788" } } : {},
  build: { sourcemap: true },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
  },
}));
