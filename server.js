#!/usr/bin/env node
// Multi-Claude HUD — the hub.
//
// A zero-dependency Node server that:
//   1. Receives status events from Claude Code hooks   (POST /event)
//   2. Holds live session state in memory
//   3. Streams that state to browser HUDs              (GET  /events  via SSE)
//   4. Serves the HUD dashboard                        (GET  /)
//
// Run it on any one machine on your LAN; point every browser at it.

import http from "node:http";
import os from "node:os";
import { readFileSync, appendFile, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { projectName, deriveStatus, deriveActivity, truncate } from "./lib/derive.mjs";
import { computeHistory } from "./lib/history.mjs";
import { statusOf } from "./lib/record.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.CLAUDE_HUD_PORT || process.env.PORT || 4500);
const HOST = process.env.CLAUDE_HUD_HOST || "0.0.0.0";

// Persistent activity history (append-only log of working/idle transitions).
// Kept ~8 days so the overlay's "up to a week" window always has headroom.
const HISTORY_PATH = process.env.CLAUDE_HUD_HISTORY || join(__dirname, "history.jsonl");
const HISTORY_KEEP_MS = 8 * 24 * 60 * 60_000;

// How long a session can go silent before the HUD considers it stale (ms).
// The browser computes staleness itself; this is just advisory metadata.
const STALE_MS = Number(process.env.CLAUDE_HUD_STALE_MS || 90_000);
// Drop sessions entirely after this much silence (covers crashed terminals
// that never sent a SessionEnd).
const EVICT_MS = Number(process.env.CLAUDE_HUD_EVICT_MS || 30 * 60_000);

/** @type {Map<string, object>} sessionId -> session record */
const sessions = new Map();
/** @type {Set<import('node:http').ServerResponse>} connected SSE clients */
const clients = new Set();

const now = () => Date.now();

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

// deriveStatus, deriveActivity, projectName, truncate live in ./lib/derive.mjs.

function applyEvent(event) {
  const id = event.session_id || `${event.host || "unknown"}:${event.cwd || "?"}`;
  const ts = now();

  if (event.hook_event_name === "SessionEnd") {
    sessions.delete(id);
    broadcast({ type: "remove", id });
    return;
  }

  const prev = sessions.get(id) || {};
  const status = deriveStatus(event);
  const record = {
    id,
    host: event.host || prev.host || "unknown",
    user: event.user || prev.user || "",
    cwd: event.cwd || prev.cwd || "",
    project: projectName(event.cwd || prev.cwd),
    model: event.model || prev.model || "",
    version: event.version || prev.version || "",
    status,
    activity: deriveActivity(event),
    event: event.hook_event_name,
    startedAt: prev.startedAt || ts,
    updatedAt: ts,
    // Last moment this session was actively working — drives the overlay's
    // green → yellow → red light. Stays put while the session sits idle.
    lastWorkingAt:
      status === "working" ? ts : prev.lastWorkingAt || prev.startedAt || ts,
  };

  // Keep the most informative prompt/tool around even as status flips.
  if (event.hook_event_name === "UserPromptSubmit" && event.prompt) {
    record.lastPrompt = truncate(event.prompt, 200);
  } else {
    record.lastPrompt = prev.lastPrompt || "";
  }

  sessions.set(id, record);
  broadcast({ type: "update", session: record });
}

// ---------------------------------------------------------------------------
// Activity history
//
// We log only working↔idle transitions (plus start/end) per session. From that
// sparse log we can reconstruct, for any time window, how long each terminal
// was alive and how long it was green (working) / yellow (idle < threshold) /
// red (idle ≥ threshold) — the yellow/red split is derived per idle stretch at
// query time, so it honours whatever red-threshold the viewer has set.
// ---------------------------------------------------------------------------

/** @type {Array<{t:number,id:string,host:string,name:string,s:string,ev:string}>} */
let history = [];
const lastStatus = new Map(); // id -> last logged status ("working"|"idle"|"end")

function loadHistory() {
  if (!existsSync(HISTORY_PATH)) return;
  try {
    const cutoff = now() - HISTORY_KEEP_MS;
    const lines = readFileSync(HISTORY_PATH, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.t >= cutoff) history.push(e);
      } catch {
        /* skip bad line */
      }
    }
    // Rewrite the pruned log and seed lastStatus from the newest event per id.
    writeFileSync(HISTORY_PATH, history.map((e) => JSON.stringify(e)).join("\n") + (history.length ? "\n" : ""));
    for (const e of history) lastStatus.set(e.id, e.ev === "end" ? "end" : e.s);
  } catch {
    /* start fresh on any error */
  }
}

function logEvent(id, host, name, status, ev) {
  const e = { t: now(), id, host: host || "", name: name || "", s: status, ev };
  history.push(e);
  lastStatus.set(id, ev === "end" ? "end" : status);
  appendFile(HISTORY_PATH, JSON.stringify(e) + "\n", () => {});
}

// Log a status only when it differs from what's already recorded — this makes
// it idempotent across hub restarts (re-seeing an idle terminal logs nothing).
function logState(id, host, name, status) {
  if (lastStatus.get(id) === status) return;
  logEvent(id, host, name, status, "state");
}

function logEnd(id, host, name) {
  if (lastStatus.get(id) === "end") return;
  logEvent(id, host, name, "idle", "end");
}

// computeHistory lives in ./lib/history.mjs (pure, unit-tested).

// Reconcile a full snapshot of one machine's live sessions (from scanner.js).
// Adds/updates everything reported, and removes any previously-seen scan
// session from that host that is no longer present (its terminal was closed).
function applyScan(scan) {
  const host = scan.host || "unknown";
  const ts = now();
  const incoming = new Set();

  for (const s of scan.sessions || []) {
    if (!s.sessionId) continue;
    const id = s.sessionId;
    incoming.add(id);
    const prev = sessions.get(id) || {};
    const status = statusOf(s.status); // working | waiting | idle
    const cwd = s.cwd || prev.cwd || "";
    const record = {
      id,
      host,
      user: scan.user || prev.user || "",
      cwd,
      project: projectName(cwd),
      name: s.name || prev.name || "",
      platform: scan.platform || prev.platform || "",
      status,
      activity: status === "working" ? "working" : status === "waiting" ? "waiting for you" : "idle",
      source: "scan",
      startedAt: s.startedAt || prev.startedAt || ts,
      updatedAt: ts,
      // working → now; otherwise the moment the status last changed (drives the
      // "how long" badge under the light).
      lastWorkingAt:
        status === "working" ? ts : s.statusUpdatedAt || prev.lastWorkingAt || ts,
    };

    // Record working/waiting/idle transitions to the activity history.
    logState(id, host, record.name || record.project, status);

    // Only broadcast when something a viewer cares about actually changed,
    // so steady idle lights don't churn every scan cycle.
    const sig = `${record.status}|${record.lastWorkingAt}|${record.name}|${record.project}`;
    sessions.set(id, record);
    if (sig !== signatures.get(id)) {
      signatures.set(id, sig);
      broadcast({ type: "update", session: record });
    }
  }

  // Remove scan-sourced sessions from this host that vanished (terminal closed).
  for (const [id, rec] of sessions) {
    if (rec.source === "scan" && rec.host === host && !incoming.has(id)) {
      logEnd(id, rec.host, rec.name || rec.project);
      sessions.delete(id);
      signatures.delete(id);
      broadcast({ type: "remove", id });
    }
  }
}
const signatures = new Map(); // id -> last broadcast signature (de-dupes scans)

// Periodically evict long-dead sessions.
setInterval(() => {
  const cutoff = now() - EVICT_MS;
  for (const [id, s] of sessions) {
    if (s.updatedAt < cutoff) {
      sessions.delete(id);
      broadcast({ type: "remove", id });
    }
  }
}, 60_000).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy(); // basic guard
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

let HUD_HTML = "";
function hudHtml() {
  // Re-read in dev-friendly fashion only if not cached.
  if (!HUD_HTML) HUD_HTML = readFileSync(join(__dirname, "public", "index.html"), "utf8");
  return HUD_HTML;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS — hooks may post from other hosts.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // --- Ingest events from Claude Code hooks ---
  if (req.method === "POST" && url.pathname === "/event") {
    try {
      const body = await readBody(req);
      const event = body ? JSON.parse(body) : {};
      applyEvent(event);
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }

  // --- Ingest a full per-machine snapshot from the scanner ---
  if (req.method === "POST" && url.pathname === "/scan") {
    try {
      const body = await readBody(req);
      const scan = body ? JSON.parse(body) : {};
      applyScan(scan);
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }

  // --- Activity history aggregated over a time window ---
  if (req.method === "GET" && url.pathname === "/history") {
    const to = now();
    const windowMs = Math.min(
      HISTORY_KEEP_MS,
      Math.max(60_000, Number(url.searchParams.get("windowMs")) || 60 * 60_000)
    );
    const activeIds = new Set(sessions.keys());
    const rows = computeHistory(history, to - windowMs, to, activeIds);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ now: to, windowMs, rows }));
    return;
  }

  // --- JSON snapshot (debugging / polling clients) ---
  if (req.method === "GET" && url.pathname === "/api/state") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        now: now(),
        staleMs: STALE_MS,
        sessions: [...sessions.values()],
      })
    );
    return;
  }

  // --- SSE live stream for the HUD ---
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 3000\n\n");
    // Initial snapshot.
    res.write(
      `data: ${JSON.stringify({
        type: "snapshot",
        now: now(),
        staleMs: STALE_MS,
        sessions: [...sessions.values()],
      })}\n\n`
    );
    clients.add(res);

    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* handled on close */
      }
    }, 25_000);

    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  // --- The HUD page ---
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(hudHtml());
    } catch {
      res.writeHead(500).end("HUD page not found (public/index.html missing).");
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
});

// Start the hub. Returns a promise resolving to the listening server, so tests
// can boot it on an ephemeral port and tear it down.
export function startHub({ port = PORT, host = HOST } = {}) {
  loadHistory();
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

// Auto-start only when run directly (`node server.js`), not when imported.
const runDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  startHub().then(() => {
    const addrs = lanAddresses();
    console.log("┌────────────────────────────────────────────────┐");
    console.log("│  Multi-Claude HUD — hub is running             │");
    console.log("└────────────────────────────────────────────────┘");
    console.log(`  Local HUD:    http://localhost:${PORT}`);
    for (const a of addrs) console.log(`  Network HUD:  http://${a}:${PORT}`);
    console.log("");
    console.log("  Run the scanner on each machine with Claude terminals:");
    const example = addrs[0] || "<this-machine-ip>";
    console.log(`    node scanner.js --hub http://${example}:${PORT}`);
    console.log("");
  });
}

function lanAddresses() {
  const out = [];
  const nics = os.networkInterfaces();
  for (const name of Object.keys(nics)) {
    for (const ni of nics[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}
