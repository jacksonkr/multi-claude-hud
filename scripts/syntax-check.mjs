#!/usr/bin/env node
// Cross-platform syntax check: `node --check` every source file (respecting
// each folder's CommonJS/ESM resolution). Catches files the test suite doesn't
// import — overlay/main.js, preload.js, scanner.js, etc.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const EXTS = new Set([".js", ".mjs", ".cjs"]);
const SKIP = new Set(["node_modules", ".git", "coverage", "dist", "build"]);

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXTS.has(extname(p))) files.push(p);
  }
})(".");

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    failed++;
    console.error(`✗ ${f}\n${e.stderr?.toString() || e.message}`);
  }
}
console.log(`syntax-check: ${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
