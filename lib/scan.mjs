// Pure part of the scanner: given the session-file objects read from
// ~/.claude/sessions and the set of currently-running claude PIDs, return the
// normalized list of live sessions to report to the hub.
//
// We keep a session iff its PID is a live claude process. We deliberately do
// NOT compare process start time to the file's startedAt: `claude --continue`
// (resume) keeps the original, older startedAt, which a start-time match would
// wrongly reject. PID reuse by non-claude programs is already excluded because
// `liveClaudePids` only ever contains genuine claude processes.

/**
 * @param {Array<object>} sessionFiles parsed ~/.claude/sessions/<pid>.json objects
 * @param {Set<number>|Map<number, any>} liveClaudePids PIDs of running claude processes
 */
export function filterLiveSessions(sessionFiles, liveClaudePids) {
  const live = [];
  for (const s of sessionFiles) {
    if (!s || !s.sessionId || !s.pid) continue;
    if (!liveClaudePids.has(s.pid)) continue;
    live.push({
      sessionId: s.sessionId,
      cwd: s.cwd || "",
      name: s.name && s.name !== "-" ? s.name : "",
      status: s.status || "idle",
      startedAt: s.startedAt || 0,
      statusUpdatedAt: s.statusUpdatedAt || s.updatedAt || s.startedAt || 0,
    });
  }
  return live;
}
