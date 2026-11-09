// Seeds memory-core's short-term recall store in the SANDBOX state DB with
// labelled fixture rows: 1 entry waiting for promotion, 2 promoted today.
const { DatabaseSync } = require("node:sqlite");
const { createHash } = require("node:crypto");
const path = require("node:path");
const ws = path.resolve("<SANDBOX>/.openclaw/workspace");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const wsKey = sha(ws);
const db = new DatabaseSync("<SANDBOX>/.openclaw/state/openclaw.sqlite");
db.exec("PRAGMA busy_timeout=5000");
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const base = (line, snippet, extra) => ({
  path: "memory/2026-11-08.md", source: "memory", startLine: line, endLine: line, snippet,
  recallCount: 3, dailyCount: 1, groundedCount: 0, totalScore: 2.4, maxScore: 0.86,
  firstRecalledAt: iso(now - 86400000), lastRecalledAt: iso(now - 3600000),
  queryHashes: ["q1", "q2", "q3"], recallDays: ["2026-11-08", "2026-11-09"], ...extra,
});
const rows = [
  ["memory:memory/2026-11-08.md:3:3", base(3, "Fixture note: the team prefers green tea in the afternoon.", {})],
  ["memory:memory/2026-11-08.md:4:4", base(4, "Fixture note: release review moved to Thursdays.", { promotedAt: iso(now - 2 * 3600000) })],
  ["memory:memory/2026-11-08.md:5:5", base(5, "Fixture note: the staging host is rebuilt every Monday.", { promotedAt: iso(now - 3 * 3600000) })],
];
const ins = db.prepare("INSERT OR REPLACE INTO plugin_state_entries (plugin_id, namespace, entry_key, value_json, created_at, expires_at) VALUES (?,?,?,?,?,NULL)");
for (const [key, value] of rows) {
  ins.run("memory-core", "short-term-recall", `${wsKey}:${sha(key)}`,
    JSON.stringify({ version: 1, workspaceKey: wsKey, workspaceDir: ws, key, value }), now);
}
ins.run("memory-core", "short-term-meta", `${wsKey}:${sha("recall")}`,
  JSON.stringify({ version: 1, workspaceKey: wsKey, workspaceDir: ws, key: "recall", value: { updatedAt: iso(now) } }), now);
console.log("seeded", rows.length, "rows for workspace key", wsKey.slice(0, 12));
