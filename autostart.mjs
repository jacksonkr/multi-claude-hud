#!/usr/bin/env node
// Install (or remove) login auto-start for the hub and/or overlay.
//
//   node autostart.mjs                 # start hub + overlay at login
//   node autostart.mjs --no-hub        # overlay only (a view-only device)
//   node autostart.mjs --no-overlay    # hub only (a headless aggregator)
//   node autostart.mjs remove          # undo
//
// Uses each OS's user-session login mechanism (Windows Startup folder, macOS
// LaunchAgent, Linux XDG autostart) so the Electron overlay can show a window.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const REMOVE = args.includes("remove") || args.includes("--remove");
const withHub = !args.includes("--no-hub");
const withOverlay = !args.includes("--no-overlay");
const LABEL = "multi-claude-hud";

if (!REMOVE && !withHub && !withOverlay) {
  console.error("Nothing to start (you passed both --no-hub and --no-overlay).");
  process.exit(1);
}

const platform = process.platform;
try {
  if (platform === "win32") REMOVE ? winRemove() : winInstall();
  else if (platform === "darwin") REMOVE ? macRemove() : macInstall();
  else REMOVE ? linuxRemove() : linuxInstall();
} catch (e) {
  console.error("autostart failed:", e?.message || e);
  process.exit(1);
}

// ---- Windows: a hidden VBS launcher in the Startup folder ------------------
function winStartupPath() {
  return path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    `${LABEL}.vbs`
  );
}
function winInstall() {
  const runs = [];
  if (withHub) runs.push(`sh.Run "cmd /c npm run hub", 0, False`);
  if (withOverlay) runs.push(`sh.Run "cmd /c npm run overlay", 0, False`);
  const vbs =
    `Set sh = CreateObject("WScript.Shell")\r\n` +
    `sh.CurrentDirectory = "${ROOT.replace(/"/g, '""')}"\r\n` +
    runs.join("\r\n") +
    "\r\n";
  const p = winStartupPath();
  fs.writeFileSync(p, vbs);
  done(p);
}
function winRemove() {
  rm(winStartupPath());
}

// ---- macOS: a LaunchAgent plist --------------------------------------------
function macPlistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `com.${LABEL}.plist`);
}
function macInstall() {
  const sh = posixLaunchCommand();
  const plist =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0"><dict>\n` +
    `  <key>Label</key><string>com.${LABEL}</string>\n` +
    `  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${xml(sh)}</string></array>\n` +
    `  <key>RunAtLoad</key><true/>\n` +
    `</dict></plist>\n`;
  const p = macPlistPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, plist);
  try {
    execFileSync("launchctl", ["unload", p], { stdio: "ignore" });
  } catch {}
  try {
    execFileSync("launchctl", ["load", "-w", p], { stdio: "ignore" });
  } catch {}
  done(p);
}
function macRemove() {
  const p = macPlistPath();
  try {
    execFileSync("launchctl", ["unload", "-w", p], { stdio: "ignore" });
  } catch {}
  rm(p);
}

// ---- Linux: an XDG autostart .desktop entry --------------------------------
function linuxDesktopPath() {
  return path.join(os.homedir(), ".config", "autostart", `${LABEL}.desktop`);
}
function linuxInstall() {
  const entry =
    `[Desktop Entry]\n` +
    `Type=Application\n` +
    `Name=Multi-Claude HUD\n` +
    `Exec=sh -c "${posixLaunchCommand().replace(/"/g, '\\"')}"\n` +
    `X-GNOME-Autostart-enabled=true\n`;
  const p = linuxDesktopPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, entry);
  done(p);
}
function linuxRemove() {
  rm(linuxDesktopPath());
}

// ---- helpers ---------------------------------------------------------------
function posixLaunchCommand() {
  const cd = `cd '${ROOT.replace(/'/g, "'\\''")}'`;
  const run = [];
  if (withHub) run.push(`(npm run hub >/dev/null 2>&1 &)`);
  if (withOverlay) run.push(`npm run overlay >/dev/null 2>&1`);
  return `${cd} && ${run.join(" ; ")}`;
}
function xml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function rm(p) {
  try {
    fs.unlinkSync(p);
    console.log(`Removed ${p}`);
  } catch {
    console.log(`Nothing to remove at ${p}`);
  }
}
function done(p) {
  const what = [withHub && "hub", withOverlay && "overlay"].filter(Boolean).join(" + ");
  console.log(`✓ Auto-start installed (${what}) at login.`);
  console.log(`  ${p}`);
  console.log(`  Remove with:  node autostart.mjs remove`);
}
