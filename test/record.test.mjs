import { test } from "node:test";
import assert from "node:assert/strict";
import { toRecord, reconcile, removeHost } from "../lib/record.mjs";

test("toRecord maps busy/waiting/idle and derives project + lastWorkingAt", () => {
  const now = 1000;
  const work = toRecord({ sessionId: "a", cwd: "/x/api", name: "api", status: "busy", startedAt: 1 }, { host: "h", source: "lan" }, now);
  assert.equal(work.status, "working");
  assert.equal(work.project, "api");
  assert.equal(work.lastWorkingAt, now); // working -> now
  assert.equal(work.source, "lan");

  const waiting = toRecord({ sessionId: "w", cwd: "/x/api", status: "waiting", startedAt: 1, statusUpdatedAt: 300 }, { host: "h" }, now);
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.lastWorkingAt, 300);

  const idle = toRecord({ sessionId: "b", cwd: "/x/web", status: "idle", startedAt: 1, statusUpdatedAt: 500 }, { host: "h" }, now);
  assert.equal(idle.status, "idle");
  assert.equal(idle.lastWorkingAt, 500);
});

test("reconcile reports adds/changes and removes vanished sessions", () => {
  const store = new Map();
  const ctx = { source: "lan" };

  let r = reconcile(store, "mac", [{ sessionId: "s1", status: "busy", startedAt: 1 }], ctx, 10);
  assert.equal(r.updates.length, 1);
  assert.equal(r.removed.length, 0);

  // Same state again -> no update emitted (no-op suppressed).
  r = reconcile(store, "mac", [{ sessionId: "s1", status: "busy", startedAt: 1 }], ctx, 10);
  assert.equal(r.updates.length, 0);

  // Status change -> update emitted.
  r = reconcile(store, "mac", [{ sessionId: "s1", status: "idle", startedAt: 1, statusUpdatedAt: 20 }], ctx, 30);
  assert.equal(r.updates.length, 1);

  // Session disappears -> removed.
  r = reconcile(store, "mac", [], ctx, 40);
  assert.deepEqual(r.removed, ["s1"]);
});

test("reconcile only touches its own host + source", () => {
  const store = new Map();
  reconcile(store, "mac", [{ sessionId: "m1", status: "busy", startedAt: 1 }], { source: "lan" }, 1);
  reconcile(store, "pc", [{ sessionId: "p1", status: "busy", startedAt: 1 }], { source: "lan" }, 1);
  // Reconciling mac with empty must not remove pc's session.
  const r = reconcile(store, "mac", [], { source: "lan" }, 2);
  assert.deepEqual(r.removed, ["m1"]);
  assert.ok(store.has("p1"));
});

test("removeHost drops all of a host's records", () => {
  const store = new Map();
  reconcile(store, "mac", [{ sessionId: "a", status: "busy", startedAt: 1 }, { sessionId: "b", status: "idle", startedAt: 1 }], { source: "lan" }, 1);
  const removed = removeHost(store, "mac", "lan").sort();
  assert.deepEqual(removed, ["a", "b"]);
  assert.equal(store.size, 0);
});
