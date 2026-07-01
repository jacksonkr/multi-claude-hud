#!/usr/bin/env node
// Run the test suite via `node --test <files…>`. We enumerate the files
// ourselves instead of passing a glob, because `node --test` only expands
// globs on Node 21+ — this keeps the suite runnable on Node 18/20 too.

import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const dir = "test";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => join(dir, f));

if (!files.length) {
  console.error("No test files found in test/");
  process.exit(1);
}

try {
  execFileSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
} catch {
  process.exit(1); // node --test already printed the failures
}
