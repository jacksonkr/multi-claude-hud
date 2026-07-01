#!/usr/bin/env node
// Emit this environment's live Claude sessions as JSON on stdout. Used by the
// Windows pass-through: the Windows app runs this *inside* each WSL distro via
// `wsl -d <distro> -e node scan-emit.mjs`, so it sees the distro's own
// processes and ~/.claude. Reuses the exact same scan logic as everywhere else.

import { scanLocal } from "./lib/localscan.mjs";

try {
  const sessions = await scanLocal();
  process.stdout.write(JSON.stringify(sessions));
} catch {
  process.stdout.write("[]");
}
