#!/usr/bin/env node
// Multi-Claude HUD — hook installer.
//
// Adds (or removes) the HUD reporter hooks in your Claude Code user settings
// (~/.claude/settings.json). Run this once on every machine that runs Claude
// Code, pointing it at your hub:
//
//   node install-hooks.js --hub http://192.168.1.10:4500
//   node install-hooks.js --remove        # tear the hooks back out
//
// It is idempotent: re-running replaces our managed hooks rather than stacking.

import os from "node:os";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TAG = "multi-claude-hud"; // marker so we can find/replace our own hooks

// Which Claude Code hook events we report, and the matcher (if any).
const EVENTS = [
  { name: "SessionStart" },
  { name: "UserPromptSubmit" },
  { name: "PreToolUse", matcher: "*" },
  { name: "PostToolUse", matcher: "*" },
  { name: "Notification" },
  { name: "Stop" },
  { name: "SubagentStop" },
  { name: "SessionEnd" },
];

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const REMOVE = process.argv.includes("--remove");
const hub = arg("--hub");
const settingsPath =
  arg("--settings") || join(os.homedir(), ".claude", "settings.json");
const reporter = join(__dirname, "hook-report.js");

function loadSettings() {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (e) {
    console.error(`Could not parse ${settingsPath}: ${e.message}`);
    console.error("Refusing to overwrite a file I can't read. Fix it and retry.");
    process.exit(1);
  }
}

// Build the command Claude Code will run for a given event. We quote the path
// for spaces, and force the event name so matchers/edge-cases stay correct.
function commandFor(eventName) {
  const node = "node";
  return `${node} "${reporter}" --event ${eventName}`;
}

// Strip any hooks we previously installed (identified by the reporter path).
function stripOurHooks(hooks) {
  const clean = {};
  for (const [event, groups] of Object.entries(hooks || {})) {
    const keptGroups = [];
    for (const group of groups) {
      const keptHooks = (group.hooks || []).filter(
        (h) => !(h.command && h.command.includes("hook-report.js"))
      );
      if (keptHooks.length) keptGroups.push({ ...group, hooks: keptHooks });
    }
    if (keptGroups.length) clean[event] = keptGroups;
  }
  return clean;
}

function main() {
  const settings = loadSettings();
  settings.hooks = stripOurHooks(settings.hooks);

  if (REMOVE) {
    saveSettings(settings);
    console.log(`Removed Multi-Claude HUD hooks from ${settingsPath}`);
    return;
  }

  if (!hub) {
    console.error("Missing --hub <url>.  Example:");
    console.error("  node install-hooks.js --hub http://192.168.1.10:4500");
    process.exit(1);
  }

  // Persist the hub URL beside the reporter so it needs no env/args at runtime.
  writeConfig(hub);

  for (const ev of EVENTS) {
    const group = { hooks: [{ type: "command", command: commandFor(ev.name) }] };
    if (ev.matcher) group.matcher = ev.matcher;
    (settings.hooks[ev.name] ||= []).push(group);
  }

  saveSettings(settings);

  console.log(`✓ Installed Multi-Claude HUD hooks in ${settingsPath}`);
  console.log(`✓ Hub URL: ${hub}`);
  console.log(`✓ Reporter: ${reporter}`);
  console.log("");
  console.log("Open a new Claude Code session and watch it appear on the HUD.");
}

function writeConfig(hubUrl) {
  const cfgPath = join(__dirname, "hud.config.json");
  writeFileSync(cfgPath, JSON.stringify({ hub: hubUrl }, null, 2) + "\n");
}

function saveSettings(settings) {
  const dir = dirname(settingsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(settingsPath)) {
    try {
      copyFileSync(settingsPath, settingsPath + ".hud-backup");
    } catch {
      /* best effort backup */
    }
  }
  // Drop the empty hooks key if we removed everything.
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

main();
