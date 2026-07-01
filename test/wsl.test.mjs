import { test } from "node:test";
import assert from "node:assert/strict";
import { toWslPath, scanAllWsl, filterDistros } from "../lib/wsl.mjs";

test("filterDistros drops docker-desktop system distros", () => {
  assert.deepEqual(
    filterDistros(["Ubuntu", "docker-desktop", "docker-desktop-data", "Debian"]),
    ["Ubuntu", "Debian"]
  );
});

test("toWslPath converts a Windows path to a /mnt path", () => {
  const bs = String.fromCharCode(92);
  assert.equal(toWslPath("C:" + bs + "Users" + bs + "j" + bs + "x.mjs"), "/mnt/c/Users/j/x.mjs");
  assert.equal(toWslPath("D:" + bs + "a" + bs + "b"), "/mnt/d/a/b");
  // Already-unix-ish input is left with forward slashes.
  assert.equal(toWslPath("/already/unix"), "/already/unix");
});

test("scanAllWsl is a no-op (returns []) on non-Windows", async () => {
  if (process.platform === "win32") return; // skip on Windows (would hit wsl.exe)
  assert.deepEqual(await scanAllWsl(), []);
});
