// Local discovery of this machine's live Claude terminals: enumerate running
// `claude` processes and read Claude Code's per-session files. Shared by the
// standalone scanner and the overlay's main process.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { filterLiveSessions } from "./scan.mjs";

export const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");

// pid -> process start time (ms). The set only ever contains genuine claude
// processes, which is what filterLiveSessions relies on.
export function getLiveClaudeProcs(timeoutMs = 2800) {
  return process.platform === "win32" ? winProcs(timeoutMs) : unixProcs(timeoutMs);
}

function winProcs(timeoutMs) {
  const ps =
    "Get-Process -Name claude -ErrorAction SilentlyContinue | ForEach-Object { " +
    "$ms = try { [DateTimeOffset]::new($_.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } catch { 0 }; " +
    "[pscustomobject]@{ pid=$_.Id; start=$ms } } | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        const map = new Map();
        if (err || !stdout) return resolve(map);
        try {
          let arr = JSON.parse(stdout);
          if (!Array.isArray(arr)) arr = [arr];
          for (const p of arr) map.set(Number(p.pid), Number(p.start));
        } catch {
          /* leave empty */
        }
        resolve(map);
      }
    );
  });
}

function unixProcs(timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-axo", "pid=,lstart=,comm="],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        const map = new Map();
        if (err || !stdout) return resolve(map);
        for (const line of stdout.split("\n")) {
          const m = line.match(/^\s*(\d+)\s+(.{24})\s+(.*)$/);
          if (!m) continue;
          const pid = Number(m[1]);
          const start = Date.parse(m[2].trim());
          const comm = m[3].trim();
          if (path.basename(comm) === "claude" && Number.isFinite(start)) {
            map.set(pid, start);
          }
        }
        resolve(map);
      }
    );
  });
}

export function readSessions(dir = DEFAULT_SESSIONS_DIR) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (j && j.sessionId && j.pid) out.push(j);
    } catch {
      /* skip unreadable / half-written file */
    }
  }
  return out;
}

// Convenience: the normalized list of this machine's live sessions.
export async function scanLocal({ dir = DEFAULT_SESSIONS_DIR, timeoutMs = 2800 } = {}) {
  const [procs, sessions] = [await getLiveClaudeProcs(timeoutMs), readSessions(dir)];
  return filterLiveSessions(sessions, procs);
}
