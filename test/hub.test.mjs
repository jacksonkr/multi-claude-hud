import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

// Point history at a throwaway file BEFORE importing the hub.
const HIST = path.join(os.tmpdir(), `hud-hist-${process.pid}-${Date.now()}.jsonl`);
process.env.CLAUDE_HUD_HISTORY = HIST;

let server, base;

before(async () => {
  const { startHub } = await import("../server.js");
  server = await startHub({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  try { rmSync(HIST); } catch {}
});

const post = (p, body) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJson = (p) => fetch(base + p).then((r) => r.json());

const scan = (sessions) => post("/scan", { host: "testbox", user: "u", platform: "linux", sessions });

test("healthz responds", async () => {
  const h = await getJson("/healthz");
  assert.equal(h.ok, true);
});

test("scan ingests sessions and /api/state reflects them", async () => {
  await scan([
    { sessionId: "s1", cwd: "/x/api", name: "api", status: "busy", startedAt: 1, statusUpdatedAt: 1 },
    { sessionId: "s2", cwd: "/x/web", name: "web", status: "idle", startedAt: 1, statusUpdatedAt: 1 },
    { sessionId: "s3", cwd: "/x/cli", name: "cli", status: "waiting", startedAt: 1, statusUpdatedAt: 1 },
  ]);
  const state = await getJson("/api/state");
  const byId = Object.fromEntries(state.sessions.map((s) => [s.id, s]));
  assert.equal(state.sessions.length, 3);
  assert.equal(byId.s1.status, "working"); // busy -> working
  assert.equal(byId.s2.status, "idle");
  assert.equal(byId.s3.status, "waiting"); // waiting -> waiting (yellow)
  assert.equal(byId.s1.name, "api");
});

test("/history returns a row per terminal with numeric splits", async () => {
  const { rows } = await getJson("/history?windowMs=3600000");
  const names = rows.map((r) => r.name).sort();
  assert.deepEqual(names, ["api", "cli", "web"]);
  for (const r of rows) {
    for (const k of ["green", "yellow", "red", "alive"]) {
      assert.ok(Number.isFinite(r[k]) && r[k] >= 0, `${k} should be a non-negative number`);
    }
  }
});

test("scan reconciliation removes a terminal that disappears", async () => {
  await scan([{ sessionId: "s1", cwd: "/x/api", name: "api", status: "busy", startedAt: 1, statusUpdatedAt: 1 }]);
  const state = await getJson("/api/state");
  const ids = state.sessions.map((s) => s.id).sort();
  assert.deepEqual(ids, ["s1"]); // s2 was reconciled away
});

test("unknown route 404s", async () => {
  const res = await fetch(base + "/nope");
  assert.equal(res.status, 404);
});
