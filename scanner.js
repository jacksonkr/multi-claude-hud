#!/usr/bin/env node
// Multi-Claude HUD — the scanner (per-machine presence reporter).
//
// Claude Code writes a file per running session to ~/.claude/sessions/<pid>.json
// containing { pid, sessionId, cwd, name, status, startedAt, statusUpdatedAt }.
// This scanner reads those, keeps only the ones whose process is genuinely
// alive (PID running AND its start time matches the session's startedAt — which
// rules out PID reuse and stale leftovers), and reports the live set to the hub
// every few seconds.
//
// Unlike hooks, this sees EVERY open terminal — including ones that have been
// sitting idle for hours — because it doesn't depend on an event firing.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { getLiveClaudeProcs, readSessions, DEFAULT_SESSIONS_DIR } from "./lib/localscan.mjs";
import { filterLiveSessions } from "./lib/scan.mjs";
import { scanAllWsl } from "./lib/wsl.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SESSIONS_DIR = DEFAULT_SESSIONS_DIR;
const INTERVAL_MS = Number(process.env.CLAUDE_HUD_SCAN_MS || 3000);
const HOST = process.env.CLAUDE_HUD_NAME || os.hostname();
const USER = os.userInfo().username;

function resolveHub() {
  const i = process.argv.indexOf("--hub");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env.CLAUDE_HUD_URL) return process.env.CLAUDE_HUD_URL;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "hud.config.json"), "utf8"));
    if (cfg.hub) return cfg.hub;
  } catch {
    /* no config */
  }
  return "http://localhost:4500";
}
const HUB = resolveHub();

// Live process discovery + session-file reading live in ./lib/localscan.mjs.

// --- POST the live set to the hub ------------------------------------------

function postScan(payload) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL("/scan", HUB);
    } catch {
      return resolve();
    }
    const body = Buffer.from(JSON.stringify(payload));
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.request(
      target,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": body.length },
        timeout: 4000,
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      }
    );
    req.on("error", resolve);
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
    req.write(body);
    req.end();
  });
}

// --- Main loop -------------------------------------------------------------

async function tick() {
  const procs = await getLiveClaudeProcs();
  const sessions = readSessions();

  const live = filterLiveSessions(sessions, procs);
  await postScan({ host: HOST, user: USER, platform: process.platform, sessions: live });
  let total = live.length;

  // On Windows, also report each running WSL distro as its own host.
  let wsl = [];
  try {
    wsl = await scanAllWsl();
  } catch {}
  for (const { distro, sessions: wslSessions } of wsl) {
    await postScan({ host: `${HOST}/${distro}`, user: USER, platform: "wsl", sessions: wslSessions });
    total += wslSessions.length;
  }
  return total;
}

console.log(`Multi-Claude HUD scanner → ${HUB}`);
console.log(`Host "${HOST}", scanning ${SESSIONS_DIR} every ${INTERVAL_MS}ms`);

let running = false;
async function loop() {
  if (running) return;
  running = true;
  try {
    const n = await tick();
    if (process.env.CLAUDE_HUD_DEBUG) console.log(`reported ${n} live session(s)`);
  } catch (e) {
    if (process.env.CLAUDE_HUD_DEBUG) console.error("scan error:", e.message);
  } finally {
    running = false;
  }
}

loop();
setInterval(loop, INTERVAL_MS);
