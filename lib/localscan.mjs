// Local discovery of this machine's live Claude terminals: enumerate running
// `claude` processes and read Claude Code's per-session files. Shared by the
// standalone scanner and the overlay's main process.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { filterLiveSessions } from "./scan.mjs";

export const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");

// Map of live claude pid -> number of child processes it has. The child count
// lets us tell a finished session (0 children) from one still running an
// attached background shell (>0). Only genuine claude processes are included,
// which is what filterLiveSessions relies on for liveness.
export function getLiveClaudeProcs(timeoutMs = 2800) {
  return process.platform === "win32" ? winProcs(timeoutMs) : unixProcs(timeoutMs);
}

// A child must be at least this old to count as a real background task/monitor
// (rather than a quick foreground command Claude is briefly running).
const CHILD_MIN_AGE_S = 15;

function winProcs(timeoutMs) {
  // Count child processes that look like a navigable background task: exclude
  // MCP servers (always-present infra) and children younger than the threshold
  // (transient foreground commands).
  const ps =
    "$now = Get-Date; " +
    "$all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine,CreationDate; " +
    "$all | Where-Object { $_.Name -eq 'claude.exe' } | ForEach-Object { $c=$_.ProcessId; " +
    "[pscustomobject]@{ pid=$c; kids=@($all | Where-Object { $_.ParentProcessId -eq $c -and $_.CommandLine -notmatch 'mcp' -and $_.CreationDate -and ($now - $_.CreationDate).TotalSeconds -gt " +
    CHILD_MIN_AGE_S +
    " }).Count } } | ConvertTo-Json -Compress";
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
          for (const p of arr) map.set(Number(p.pid), Number(p.kids) || 0);
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
      ["-axo", "pid=,ppid=,lstart=,comm=,command="],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const map = new Map();
        if (err || !stdout) return resolve(map);
        const nowMs = Date.now();
        const rows = [];
        const childCount = new Map();
        for (const line of stdout.split("\n")) {
          // pid ppid lstart(24 chars) comm command
          const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(\S+)\s*(.*)$/);
          if (!m) continue;
          const pid = Number(m[1]);
          const ppid = Number(m[2]);
          const start = Date.parse(m[3].trim());
          rows.push({ pid, comm: m[4] });
          const ageS = Number.isFinite(start) ? (nowMs - start) / 1000 : 0;
          // Count only non-MCP children older than the threshold.
          if (!/mcp/i.test(m[5]) && ageS > CHILD_MIN_AGE_S) {
            childCount.set(ppid, (childCount.get(ppid) || 0) + 1);
          }
        }
        for (const r of rows) {
          if (path.basename(r.comm) === "claude") map.set(r.pid, childCount.get(r.pid) || 0);
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
