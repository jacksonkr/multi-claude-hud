// Pure presentation helpers shared by the overlay renderer and the test suite.

// A stable identifier for a terminal across restarts (its session id isn't
// stable, but host + name is). Used for favorites.
export const keyOf = (s) => `${s.host || ""}::${s.name || s.project || ""}`;

export const labelOf = (s) => s.name || s.project || s.host || "claude";

//   working (with or without a subprocess) → green
//   waiting on you                          → yellow
//   idle, but a subprocess still running    → red/green split (+ timer)
//   idle (finished)                         → red
// The green half of the split = the shell/monitor is still working; the red
// half = Claude itself is done.
export function colorOf(s) {
  if (s.status === "working") return "green";
  if (s.status === "waiting") return "yellow";
  if (s.bg) return "split";
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

// Every mode below is written in its *ascending* form; "desc" simply reverses
// it. Each mode has its own natural default direction (A–Z reads ascending,
// but "most recently finished first" reads descending), so the UI resets the
// direction to this when the mode changes.
export const SORT_DEFAULT_DIR = {
  status: "desc", // working first
  alpha: "asc", // A–Z
  lifetime: "asc", // oldest start first
  recent: "desc", // most recently finished first
};
export const defaultDirFor = (mode) => SORT_DEFAULT_DIR[mode] || "desc";

// Ascending comparators. `lastWorkingAt` is the moment a terminal stopped
// working (for one that's still working it's "now"), so ascending = finished
// longest ago first, and descending = finished most recently first.
function ascComparator(mode) {
  switch (mode) {
    case "alpha":
      return (a, b) => labelOf(a).toLowerCase().localeCompare(labelOf(b).toLowerCase());
    case "lifetime":
      return (a, b) => (a.startedAt || 0) - (b.startedAt || 0);
    case "recent":
      return (a, b) => (a.lastWorkingAt || 0) - (b.lastWorkingAt || 0);
    case "status":
    default:
      return (a, b) => {
        const aw = a.status === "working" ? 1 : 0;
        const bw = b.status === "working" ? 1 : 0;
        if (aw !== bw) return aw - bw;
        return (a.lastWorkingAt || 0) - (b.lastWorkingAt || 0);
      };
  }
}

// Comparator for a given sort mode + direction (favorites are grouped
// separately by the caller, and keep their manual drag order).
export function sortComparator(mode, dir = defaultDirFor(mode)) {
  const asc = ascComparator(mode);
  return dir === "asc" ? asc : (a, b) => -asc(a, b);
}
