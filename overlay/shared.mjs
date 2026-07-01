// Pure presentation helpers shared by the overlay renderer and the test suite.

// A stable identifier for a terminal across restarts (its session id isn't
// stable, but host + name is). Used for favorites.
export const keyOf = (s) => `${s.host || ""}::${s.name || s.project || ""}`;

export const labelOf = (s) => s.name || s.project || s.host || "claude";

// The yellow half means "an attached shell/subprocess is running"; the other
// half is Claude's own state:
//   working            → green
//   working + subproc   → green/yellow split
//   waiting on you      → yellow
//   idle + subproc      → red/yellow split
//   idle (finished)     → red
export function colorOf(s) {
  if (s.status === "working") return s.bg ? "split-green" : "green";
  if (s.status === "waiting") return "yellow";
  if (s.bg) return "split-red";
  return "red";
}

// Idle duration as a single coarse unit: 10s, 2m, 1h, 1d, 3w, 5mo, 1y.
// Never compound — always the largest unit that fits.
export function idleLabel(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "d";
  if (d < 30) return Math.floor(d / 7) + "w";
  if (d < 365) return Math.floor(d / 30) + "mo";
  return Math.floor(d / 365) + "y";
}

// Comparator for a given sort mode (favorites are grouped separately by caller).
export function sortComparator(mode) {
  return (a, b) => {
    switch (mode) {
      case "alpha":
        return labelOf(a).toLowerCase().localeCompare(labelOf(b).toLowerCase());
      case "lifetime": // longest-lived first (oldest start)
        return (a.startedAt || 0) - (b.startedAt || 0);
      case "recent": // most recently active first
        return (b.lastWorkingAt || 0) - (a.lastWorkingAt || 0);
      case "status":
      default: {
        const aw = a.status === "working" ? 0 : 1;
        const bw = b.status === "working" ? 0 : 1;
        if (aw !== bw) return aw - bw;
        return (b.lastWorkingAt || 0) - (a.lastWorkingAt || 0);
      }
    }
  };
}
