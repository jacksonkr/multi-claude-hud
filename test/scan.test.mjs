import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLiveSessions } from "../lib/scan.mjs";

const files = [
  { pid: 100, sessionId: "alive-1", cwd: "/a/proj", name: "proj", status: "busy", startedAt: 5, statusUpdatedAt: 9 },
  { pid: 200, sessionId: "dead-1", cwd: "/b", name: "b", status: "idle", startedAt: 1 },
  { pid: 300, sessionId: "resumed", cwd: "/c", name: "-", status: "idle", startedAt: 1, statusUpdatedAt: 2 },
];

test("keeps only sessions whose pid is a live claude process", () => {
  const live = filterLiveSessions(files, new Map([[100, 0], [300, 0]]));
  const ids = live.map((s) => s.sessionId).sort();
  assert.deepEqual(ids, ["alive-1", "resumed"]);
});

test("resumed session (older startedAt) is still kept — no start-time match", () => {
  // pid 300's process "started" long after its file startedAt; must still pass.
  const live = filterLiveSessions(files, new Set([300]));
  assert.equal(live.length, 1);
  assert.equal(live[0].sessionId, "resumed");
});

test("normalizes fields: empty name '-' becomes '', status defaults to idle", () => {
  const live = filterLiveSessions(files, new Set([300]));
  assert.equal(live[0].name, "");
  assert.equal(live[0].status, "idle");
  assert.equal(live[0].statusUpdatedAt, 2);
});

test("ignores malformed entries", () => {
  const live = filterLiveSessions(
    [null, { pid: 1 }, { sessionId: "x" }, { pid: 100, sessionId: "ok", startedAt: 1 }],
    new Set([1, 100])
  );
  assert.deepEqual(live.map((s) => s.sessionId), ["ok"]);
});

test("works with both Set and Map of live pids", () => {
  assert.equal(filterLiveSessions(files, new Set([100])).length, 1);
  assert.equal(filterLiveSessions(files, new Map([[100, 123]])).length, 1);
});

test("bg flag reflects child count (Map) and is false for a Set", () => {
  // Map value = number of child processes.
  const withKids = filterLiveSessions(files, new Map([[300, 2]]));
  assert.equal(withKids[0].bg, true);
  const noKids = filterLiveSessions(files, new Map([[300, 0]]));
  assert.equal(noKids[0].bg, false);
  // A plain Set carries no child info → bg false.
  assert.equal(filterLiveSessions(files, new Set([300]))[0].bg, false);
});
