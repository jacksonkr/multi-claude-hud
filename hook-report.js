#!/usr/bin/env node
// Multi-Claude HUD — the reporter.
//
// Claude Code runs this script on every lifecycle hook. It reads the hook's
// JSON payload from stdin, enriches it with this machine's identity, and POSTs
// it to the hub. It MUST be fast, silent, and never break Claude — so it
// always exits 0, swallows all errors, and gives up after a short timeout.
//
// Hub URL resolution order:
//   1. --hub <url> CLI arg
//   2. CLAUDE_HUD_URL env var
//   3. hud.config.json next to this script  ({ "hub": "http://host:port" })
//   4. http://localhost:4500

import http from "node:http";
import https from "node:https";
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HARD_TIMEOUT_MS = 1500;
// Absolute backstop: never let this process linger and stall Claude.
const bail = setTimeout(() => process.exit(0), HARD_TIMEOUT_MS + 500);
bail.unref();

function resolveHub() {
  const argIdx = process.argv.indexOf("--hub");
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1];
  if (process.env.CLAUDE_HUD_URL) return process.env.CLAUDE_HUD_URL;
  try {
    const cfg = JSON.parse(readFileSync(join(__dirname, "hud.config.json"), "utf8"));
    if (cfg.hub) return cfg.hub;
  } catch {
    /* no config file — fine */
  }
  return "http://localhost:4500";
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve(""); // run manually with no pipe
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function post(hubUrl, payload) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL("/event", hubUrl);
    } catch {
      return resolve();
    }
    const body = Buffer.from(JSON.stringify(payload));
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.request(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": body.length,
        },
        timeout: HARD_TIMEOUT_MS,
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

(async () => {
  try {
    const raw = await readStdin();
    let event = {};
    try {
      event = raw ? JSON.parse(raw) : {};
    } catch {
      event = {};
    }

    // Allow forcing the event name via CLI (handy for matchers / testing).
    const evtIdx = process.argv.indexOf("--event");
    if (evtIdx !== -1 && process.argv[evtIdx + 1]) {
      event.hook_event_name = process.argv[evtIdx + 1];
    }

    const payload = {
      ...event,
      host: process.env.CLAUDE_HUD_NAME || os.hostname(),
      user: os.userInfo().username,
      platform: process.platform,
      reportedAt: Date.now(),
    };

    await post(resolveHub(), payload);
  } catch {
    /* never throw */
  } finally {
    process.exit(0);
  }
})();
