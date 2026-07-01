// Turn a raw scan session into a display record, and reconcile one host's
// snapshot against a store (Map id->record), returning what changed. Used by
// the overlay's main process to aggregate local + LAN sources and emit the
// same update/remove messages the renderer already understands.

import { projectName } from "./derive.mjs";

// Claude's session status → base HUD status (busy → working, waiting →
// waiting, else idle). The "attached shell running" signal is carried
// separately as `bg`, and colorOf combines them (green/yellow when working+bg,
// red/yellow when idle+bg).
export function statusOf(raw) {
  if (raw === "busy") return "working";
  if (raw === "waiting") return "waiting";
  return "idle";
}

function activityOf(status, bg) {
  if (status === "working") return bg ? "working + background task" : "working";
  if (status === "waiting") return "waiting for you";
  return bg ? "background task running" : "idle";
}

export function toRecord(s, ctx, now) {
  const status = statusOf(s.status);
  const bg = !!s.bg;
  const cwd = s.cwd || "";
  return {
    id: s.sessionId,
    host: ctx.host || "unknown",
    user: ctx.user || "",
    cwd,
    project: projectName(cwd),
    name: s.name || "",
    platform: ctx.platform || "",
    status,
    bg,
    // When the attached subprocess started (refined with continuity by the
    // aggregator); drives the "how long running" badge on split lights.
    bgSince: bg ? now : null,
    activity: activityOf(status, bg),
    source: ctx.source || "net",
    startedAt: s.startedAt || now,
    updatedAt: now,
    // working → now; otherwise the moment the status last changed — drives the
    // "how long" badge under the light.
    lastWorkingAt: status === "working" ? now : s.statusUpdatedAt || s.startedAt || now,
  };
}

// What a viewer cares about — used to suppress no-op updates.
const sig = (r) => `${r.status}|${r.bg}|${r.lastWorkingAt}|${r.name}|${r.project}`;

/**
 * @param {Map<string,object>} store id -> record (mutated in place)
 * @param {string} host the reporting machine
 * @param {Array} sessions raw scan sessions from that host
 * @param {{user?:string,platform?:string,source?:string}} ctx
 * @param {number} now
 * @returns {{updates: object[], removed: string[]}}
 */
export function reconcile(store, host, sessions, ctx, now) {
  const incoming = new Set();
  const updates = [];
  for (const s of sessions || []) {
    if (!s || !s.sessionId) continue;
    incoming.add(s.sessionId);
    const rec = toRecord(s, { ...ctx, host }, now);
    const prev = store.get(s.sessionId);
    // Keep the subprocess-start time steady while it keeps running.
    rec.bgSince = rec.bg ? (prev && prev.bg && prev.bgSince ? prev.bgSince : now) : null;
    store.set(s.sessionId, rec);
    if (!prev || sig(prev) !== sig(rec)) updates.push(rec);
  }
  const removed = [];
  const source = ctx.source || "net";
  for (const [id, rec] of store) {
    if (rec.host === host && rec.source === source && !incoming.has(id)) {
      store.delete(id);
      removed.push(id);
    }
  }
  return { updates, removed };
}

// Drop every record from a host (e.g. a LAN peer that went silent).
export function removeHost(store, host, source) {
  const removed = [];
  for (const [id, rec] of store) {
    if (rec.host === host && (!source || rec.source === source)) {
      store.delete(id);
      removed.push(id);
    }
  }
  return removed;
}
