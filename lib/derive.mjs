// Pure helpers for turning Claude Code hook events into HUD-friendly fields.
// Extracted from the hub so they can be unit-tested in isolation.

export function truncate(str, n) {
  str = String(str).replace(/\s+/g, " ").trim();
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

// The folder name at the end of a cwd, handling both / and \ separators.
export function projectName(cwd) {
  if (!cwd) return "";
  const parts = String(cwd).replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || cwd;
}

// Map a raw hook event name onto a coarse status.
export function deriveStatus(event) {
  switch (event.hook_event_name) {
    case "SessionStart":
      return "idle";
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
      return "working";
    case "Notification":
      return "attention"; // waiting on permission / input
    case "Stop":
    case "SubagentStop":
      return "idle"; // done responding, awaiting the human
    case "SessionEnd":
      return "ended";
    default:
      return "working";
  }
}

// Pull a useful snippet out of common tool inputs (command, file, pattern…).
export function toolDetail(event) {
  const i = event.tool_input || {};
  const hint =
    i.command || i.file_path || i.path || i.pattern || i.url || i.description;
  return hint ? `: ${truncate(String(hint), 100)}` : "";
}

// A short human-readable line describing what a session is doing right now.
export function deriveActivity(event) {
  switch (event.hook_event_name) {
    case "SessionStart":
      return `session started${event.source ? ` (${event.source})` : ""}`;
    case "UserPromptSubmit":
      return event.prompt ? `prompt: ${truncate(event.prompt, 120)}` : "thinking…";
    case "PreToolUse":
      return `running ${event.tool_name || "tool"}${toolDetail(event)}`;
    case "PostToolUse":
      return `ran ${event.tool_name || "tool"}`;
    case "Notification":
      return event.message ? truncate(event.message, 140) : "needs your attention";
    case "Stop":
      return "finished — awaiting you";
    case "SubagentStop":
      return "subagent finished";
    case "SessionEnd":
      return `ended${event.reason ? ` (${event.reason})` : ""}`;
    default:
      return event.hook_event_name || "active";
  }
}
