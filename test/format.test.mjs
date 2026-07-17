import { test } from "node:test";
import assert from "node:assert/strict";
import {
  idleLabel,
  colorOf,
  keyOf,
  labelOf,
  sortComparator,
  defaultDirFor,
  orderSessions,
  panOffset,
} from "../overlay/shared.mjs";

// Terminals for the orderSessions tests. keyOf is `${host}::${name}`.
const mk = (name, extra = {}) => ({
  id: name,
  host: "h",
  name,
  status: "idle",
  lastWorkingAt: 0,
  ...extra,
});
const names = (list) => list.map((s) => s.name);

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

test("idleLabel always uses a single coarse unit (never compound)", () => {
  assert.equal(idleLabel(10 * S), "10s");
  assert.equal(idleLabel(59 * S), "59s");
  assert.equal(idleLabel(60 * S), "1m");
  assert.equal(idleLabel(2 * M + 10 * S), "2m");
  assert.equal(idleLabel(60 * M), "1h");
  assert.equal(idleLabel(23 * H), "23h");
  assert.equal(idleLabel(24 * H), "1d");
  assert.equal(idleLabel(7 * D), "1w");
  assert.equal(idleLabel(29 * D), "4w");
  assert.equal(idleLabel(30 * D), "1mo");
  assert.equal(idleLabel(364 * D), "12mo");
  assert.equal(idleLabel(365 * D), "1y");
});

test("colorOf: working stays green even with a subprocess; split only when idle+bg", () => {
  assert.equal(colorOf({ status: "working", bg: false }), "green");
  assert.equal(colorOf({ status: "working", bg: true }), "green"); // working monitor → still green
  assert.equal(colorOf({ status: "waiting" }), "yellow");
  assert.equal(colorOf({ status: "idle", bg: true }), "split"); // done, shell still running (red/green)
  assert.equal(colorOf({ status: "idle", bg: false }), "red");
});

test("keyOf is stable on host+name; labelOf prefers name then project then host", () => {
  assert.equal(keyOf({ host: "mac", name: "api" }), "mac::api");
  assert.equal(keyOf({ host: "mac", project: "api" }), "mac::api");
  assert.equal(labelOf({ name: "n", project: "p", host: "h" }), "n");
  assert.equal(labelOf({ project: "p", host: "h" }), "p");
  assert.equal(labelOf({ host: "h" }), "h");
});

test("sortComparator: status puts working first, alpha sorts by label", () => {
  const work = { status: "working", name: "z", lastWorkingAt: 1 };
  const idle = { status: "idle", name: "a", lastWorkingAt: 2 };
  assert.ok(sortComparator("status")(work, idle) < 0); // working first
  assert.ok(sortComparator("alpha")(idle, work) < 0); // "a" before "z"
  assert.ok(sortComparator("lifetime")({ startedAt: 1 }, { startedAt: 2 }) < 0);
  assert.ok(sortComparator("recent")({ lastWorkingAt: 2 }, { lastWorkingAt: 1 }) < 0);
});

test("sortComparator: each mode defaults to its natural direction", () => {
  assert.equal(defaultDirFor("status"), "desc");
  assert.equal(defaultDirFor("alpha"), "asc");
  assert.equal(defaultDirFor("lifetime"), "asc");
  assert.equal(defaultDirFor("recent"), "desc");
  // An unknown mode still yields a usable comparator.
  assert.equal(defaultDirFor("nope"), "desc");
});

test("sortComparator: recent puts the most recently finished on top; asc flips it", () => {
  const justDone = { status: "idle", lastWorkingAt: 200 };
  const longAgo = { status: "idle", lastWorkingAt: 100 };
  // Default (desc) = finished most recently first.
  assert.ok(sortComparator("recent", "desc")(justDone, longAgo) < 0);
  // Ascending = finished longest ago first.
  assert.ok(sortComparator("recent", "asc")(longAgo, justDone) < 0);
  // Still-working terminals carry lastWorkingAt = now, so they lead in desc.
  const working = { status: "working", lastWorkingAt: 300 };
  const order = [longAgo, justDone, working].sort(sortComparator("recent"));
  assert.deepEqual(order, [working, justDone, longAgo]);
});

// A 600px list zoomed 2x inside an 800px container, anchored top: it spans
// 0..1200, so 400px hang off the bottom and nothing hangs off the top.
const tallTop = { top: 0, bot: 600, containerH: 800, scale: 2, originY: 0 };

test("panOffset: no pan while the content fits", () => {
  const fits = { top: 0, bot: 300, containerH: 800, scale: 2, originY: 0 };
  assert.equal(panOffset({ ...fits, cursorY: 0 }), 0);
  assert.equal(panOffset({ ...fits, cursorY: 400 }), 0);
  assert.equal(panOffset({ ...fits, cursorY: 800 }), 0);
  // Exactly filling the container is still a fit.
  assert.equal(panOffset({ top: 0, bot: 400, containerH: 800, scale: 2, originY: 0, cursorY: 800 }), 0);
});

test("panOffset: cursor at the top shows the top, at the bottom shows the bottom", () => {
  assert.equal(panOffset({ ...tallTop, cursorY: 0 }), 0); // top already flush
  assert.equal(panOffset({ ...tallTop, cursorY: 800 }), -400); // pull the last 400px up
  assert.equal(panOffset({ ...tallTop, cursorY: 400 }), -200); // linear in between
});

test("panOffset: the panned content always covers the container", () => {
  // Whatever the cursor does, no gap may open at either edge — a gap is how the
  // hover hot-zone would lose the cursor and start oscillating.
  for (let cursorY = 0; cursorY <= 800; cursorY += 50) {
    const p = panOffset({ ...tallTop, cursorY });
    const y0 = 0 + p; // scaled top edge, panned
    const y1 = 1200 + p; // scaled bottom edge, panned
    assert.ok(y0 <= 0 && y1 >= 800, `gap at cursorY=${cursorY}: [${y0}, ${y1}]`);
  }
});

test("panOffset: bottom-anchored overflows upward and pans the other way", () => {
  // Origin at the container's bottom edge: scaling pushes content up past 0.
  const tallBottom = { top: 200, bot: 800, containerH: 800, scale: 2, originY: 800 };
  // Spans -400..800, so 400px hide above and none below.
  assert.equal(panOffset({ ...tallBottom, cursorY: 0 }), 400); // push down to reveal the top
  assert.equal(panOffset({ ...tallBottom, cursorY: 800 }), 0); // already flush at the bottom
});

test("panOffset: middle-anchored overflows both ends", () => {
  // 800px of content, 2x, origin centred: spans -400..1200 — 400 over each edge.
  const mid = { top: 0, bot: 800, containerH: 800, scale: 2, originY: 400 };
  assert.equal(panOffset({ ...mid, cursorY: 0 }), 400); // reveal the top
  assert.equal(panOffset({ ...mid, cursorY: 800 }), -400); // reveal the bottom
  assert.equal(panOffset({ ...mid, cursorY: 400 }), 0); // centred, no pan
});

test("panOffset: cursor outside the container clamps instead of over-panning", () => {
  assert.equal(panOffset({ ...tallTop, cursorY: -200 }), 0);
  assert.equal(panOffset({ ...tallTop, cursorY: 5000 }), -400);
});

test("orderSessions: favorites sort like everything else by default", () => {
  const a = mk("a", { lastWorkingAt: 100 });
  const b = mk("b", { lastWorkingAt: 300 });
  const c = mk("c", { lastWorkingAt: 200 });
  const out = orderSessions([a, b, c], {
    sortMode: "recent",
    // Drag order deliberately disagrees with the sort — the sort should win.
    favorites: ["h::a", "h::b"],
  });
  assert.deepEqual(names(out), ["b", "a", "c"]); // favs (recent-first), then c
});

test("orderSessions: favManual pins favorites to their drag order", () => {
  const a = mk("a", { lastWorkingAt: 100 });
  const b = mk("b", { lastWorkingAt: 300 });
  const c = mk("c", { lastWorkingAt: 200 });
  const out = orderSessions([a, b, c], {
    sortMode: "recent",
    favManual: true,
    favorites: ["h::a", "h::b"],
  });
  assert.deepEqual(names(out), ["a", "b", "c"]); // drag order, sort ignored
});

test("orderSessions: groups never interleave and hidden are dropped", () => {
  const fav = mk("fav", { lastWorkingAt: 1 });
  const watched = mk("watched", { lastWorkingAt: 2, bg: true });
  const plain = mk("plain", { lastWorkingAt: 999 });
  const gone = mk("gone", { lastWorkingAt: 999 });
  const out = orderSessions([plain, gone, watched, fav], {
    sortMode: "recent",
    favorites: ["h::fav"],
    hidden: ["h::gone"],
  });
  // `plain` is the most recent but still sorts below both earlier groups.
  assert.deepEqual(names(out), ["fav", "watched", "plain"]);
});

test("orderSessions: a favorite is never also counted as watched", () => {
  const favBg = mk("favBg", { bg: true });
  const out = orderSessions([favBg], { favorites: ["h::favBg"] });
  assert.deepEqual(names(out), ["favBg"]); // once, not twice
});

test("sortComparator: direction reverses every mode, including tie-breaks", () => {
  const work = { status: "working", name: "z", lastWorkingAt: 1 };
  const idle = { status: "idle", name: "a", lastWorkingAt: 2 };
  assert.ok(sortComparator("status", "asc")(idle, work) < 0); // idle first
  assert.ok(sortComparator("alpha", "desc")(work, idle) < 0); // "z" before "a"
  assert.ok(sortComparator("lifetime", "desc")({ startedAt: 2 }, { startedAt: 1 }) < 0);
});
