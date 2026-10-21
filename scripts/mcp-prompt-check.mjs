// Drives real Claude (Claude Code, headless) through the MCP test prompts in
// docs/MCP_TEST_PROMPTS.md, connected only to an Expense Tracker MCP server, and checks which
// tools Claude chose and whether they succeeded.
//
//   MCP_URL=http://localhost:5173/mcp/et_… node scripts/mcp-prompt-check.mjs
//
// ONLY=6,8,11 runs a subset. Needs Claude Code on PATH (or CLAUDE_BIN) and signed in. The space names assume the test
// data from docs/MCP_TEST_PROMPTS.md ("MCP Test Flat" with Asha Rao, Bala Iyer, Chen Li and a
// "Boys" group). Each prompt runs as a fresh conversation. Uses your Claude plan's usage.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.env.MCP_URL;
if (!url) throw new Error("Set MCP_URL, e.g. http://localhost:5173/mcp/et_…");
const bin = process.env.CLAUDE_BIN ?? "claude";
const dir = mkdtempSync(join(tmpdir(), "mcp-prompts-"));
const config = join(dir, "mcp.json");
writeFileSync(config, JSON.stringify({ mcpServers: { expense: { type: "http", url } } }));

const S = "MCP Test Flat";
/** The tools the server must expose. */
const TOOLS = ["list_spaces", "get_space", "list_expenses", "list_payments", "get_balances", "add_expense", "add_expenses", "edit_expense", "record_payment"];
/** [prompt, tools Claude must call (in any order), tools it must not call, should a tool error] */
const CASES = [
  ["What Expense Tracker tools do you have? List their names only.", [], [], false],
  ["Which Expense Tracker spaces am I in, and where do I stand in each?", ["list_spaces"], [], false],
  [`Who is in ${S} and what groups does it have?`, ["get_space"], [], false],
  [`Add ₹1,200 for groceries to ${S}. I paid; split it equally between everyone.`, ["add_expense"], [], false],
  [`In ${S}, Chen paid ₹600 for beer yesterday, split between the Boys group.`, ["add_expense"], [], false],
  [`Add a ₹500 cab to ${S}: I pay 60% and Chen pays 40%.`, ["add_expense"], [], false],
  [`Add rent of ₹3,000 on 1 Oct to ${S}, split by shares: me 2 shares, Asha 1 share.`, ["add_expense"], [], false],
  [`Add ₹1,000 electricity to ${S}: I owe ₹700 and Bala owes ₹300 exactly.`, ["add_expense"], [], false],
  [`Add these to ${S} in one go: milk ₹60 split with everyone, and eggs ₹90 split between Bala and Chen.`, ["add_expenses"], [], false],
  [`Show this month's expenses in ${S}.`, ["list_expenses"], [], false],
  [`In ${S}, rename the most recent electricity expense to "Electricity bill". Don't change anything else.`, ["list_expenses", "edit_expense"], [], false],
  [`Bala paid me ₹250 for October in ${S}. Record it.`, ["record_payment"], [], false],
  [`Who owes whom in ${S}, and what payments would settle it?`, ["get_balances"], [], false],
  [`Add ₹100 for tea to ${S}, split with Zed.`, ["add_expense"], [], true],
  [`Delete the beer expense in ${S}.`, [], ["add_expense", "add_expenses", "edit_expense", "record_payment"], false],
  [`Add an expense to ${S} for dinner.`, [], ["add_expense", "add_expenses"], false],
];

function run(prompt) {
  return new Promise((resolve) => {
    const args = ["-p", prompt, "--mcp-config", config, "--strict-mcp-config", "--allowedTools", "mcp__expense",
      "--tools", "", "--output-format", "stream-json", "--verbose", "--max-turns", "12"];
    const p = spawn(bin, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    const out = { calls: [], errors: 0, answer: "", connected: false, tools: [] };
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.type === "system" && m.subtype === "init") {
          out.connected = m.mcp_servers?.some((s) => s.name === "expense" && s.status === "connected");
          out.tools = m.tools.filter((t) => t.startsWith("mcp__expense__")).map((t) => t.slice(14));
        } else if (m.type === "assistant") {
          for (const c of m.message.content) if (c.type === "tool_use") out.calls.push({ name: c.name.replace("mcp__expense__", ""), input: c.input });
        } else if (m.type === "user") {
          for (const c of m.message.content ?? []) if (c.type === "tool_result" && c.is_error) out.errors++;
        } else if (m.type === "result") out.answer = String(m.result ?? m.subtype).trim();
      }
    });
    p.on("close", () => resolve(out));
  });
}

// ONLY=6,8,11 runs just those prompts (numbered from 1).
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
let failed = 0;
let ran = 0;
for (const [i, [prompt, must, mustNot, expectError]] of CASES.entries()) {
  if (only && !only.has(i + 1)) continue;
  ran++;
  const r = await run(prompt);
  const called = r.calls.map((c) => c.name);
  const problems = [];
  if (!r.connected) problems.push("MCP server not connected");
  if (i === 0) {
    // Check the catalog by name, so adding a read tool doesn't break this check; no delete tool may appear.
    const missing = TOOLS.filter((t) => !r.tools.includes(t));
    if (missing.length) problems.push(`missing tools: ${missing.join(", ")}`);
    const deleting = r.tools.filter((t) => /delete|remove/i.test(t));
    if (deleting.length) problems.push(`unexpected delete tools: ${deleting.join(", ")}`);
  }
  for (const t of must) if (!called.includes(t)) problems.push(`did not call ${t}`);
  for (const t of mustNot) if (called.includes(t)) problems.push(`should not call ${t}`);
  if (expectError && !r.errors) problems.push("expected a tool error to relay");
  if (!expectError && r.errors && must.length) problems.push(`${r.errors} tool error(s)`);
  if (/not logged in/i.test(r.answer)) problems.push("Claude Code is not signed in");
  if (problems.length) failed++;
  console.log(`\n${problems.length ? "FAIL" : "PASS"} ${i + 1}. ${prompt}`);
  for (const c of r.calls) console.log(`   → ${c.name} ${JSON.stringify(c.input)}`);
  console.log(`   ${r.answer.replace(/\n+/g, " ⏎ ").slice(0, 500)}`);
  for (const p of problems) console.log(`   ✗ ${p}`);
}
console.log(`\n${ran - failed}/${ran} prompts passed`);
process.exit(failed ? 1 : 0);
