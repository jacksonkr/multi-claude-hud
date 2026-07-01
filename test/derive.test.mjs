import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectName,
  deriveStatus,
  deriveActivity,
  truncate,
} from "../lib/derive.mjs";

test("projectName handles unix, windows, trailing separators", () => {
  assert.equal(projectName("/Users/j/code/api-server"), "api-server");
  assert.equal(projectName("/Users/j/code/api-server/"), "api-server");
  assert.equal(projectName("C:\\dev\\frontend"), "frontend");
  assert.equal(projectName("C:\\dev\\infra\\"), "infra");
  assert.equal(projectName(""), "");
  assert.equal(projectName(undefined), "");
});

test("deriveStatus maps hook events to coarse statuses", () => {
  assert.equal(deriveStatus({ hook_event_name: "SessionStart" }), "idle");
  assert.equal(deriveStatus({ hook_event_name: "UserPromptSubmit" }), "working");
  assert.equal(deriveStatus({ hook_event_name: "PreToolUse" }), "working");
  assert.equal(deriveStatus({ hook_event_name: "Notification" }), "attention");
  assert.equal(deriveStatus({ hook_event_name: "Stop" }), "idle");
  assert.equal(deriveStatus({ hook_event_name: "SessionEnd" }), "ended");
  assert.equal(deriveStatus({ hook_event_name: "Whatever" }), "working");
});

test("truncate collapses whitespace and caps length with an ellipsis", () => {
  assert.equal(truncate("hello   world", 50), "hello world");
  assert.equal(truncate("abcdefghij", 5), "abcd…");
  assert.equal(truncate("   trim me  ", 50), "trim me");
});

test("deriveActivity produces a readable line per event", () => {
  assert.match(deriveActivity({ hook_event_name: "UserPromptSubmit", prompt: "do X" }), /prompt: do X/);
  assert.match(deriveActivity({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm run build" } }), /running Bash: npm run build/);
  assert.equal(deriveActivity({ hook_event_name: "Stop" }), "finished — awaiting you");
});
