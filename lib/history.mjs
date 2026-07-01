// Pure activity-history aggregation. Given a flat event log of working/idle
// transitions, reconstruct per-terminal green/yellow/red/alive totals within a
// time window. The yellow/red split is derived per idle stretch (first `redMs`
// is yellow, the rest red), so it honours whatever threshold the viewer set.

export const overlap = (a0, a1, b0, b1) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * @param {Array<{t:number,id:string,host:string,name:string,s:string,ev:string}>} history
 * @param {number} from  window start (ms)
 * @param {number} to    window end (ms)
 * @param {number} redMs idle duration after which time counts as "red"
 * @param {Set<string>} activeIds sessions live right now (final state runs to `to`)
 */
export function computeHistory(history, from, to, redMs, activeIds) {
  const byId = new Map();
  for (const e of history) {
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  }

  const rows = [];
  for (const [id, evs] of byId) {
    evs.sort((a, b) => a.t - b.t);
    const active = activeIds.has(id);
    let green = 0,
      yellow = 0,
      red = 0;
    const firstT = evs[0].t;
    const lastT = evs[evs.length - 1].t;
    const name = evs.findLast?.((e) => e.name)?.name || evs[evs.length - 1].name || "";
    const host = evs.findLast?.((e) => e.host)?.host || evs[evs.length - 1].host || "";

    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.ev === "end") continue; // closes the timeline; nothing after
      const segStart = e.t;
      const next = evs[i + 1];
      // Segment runs to the next event, or (if last) to `to` when still alive.
      const segEnd = next ? next.t : active ? to : e.t;
      if (segEnd <= segStart) continue;

      if (e.s === "working") {
        green += overlap(segStart, segEnd, from, to);
      } else {
        const yEnd = segStart + redMs;
        yellow += overlap(segStart, Math.min(segEnd, yEnd), from, to);
        if (segEnd > yEnd) red += overlap(yEnd, segEnd, from, to);
      }
    }

    const aliveEnd = active ? to : lastT;
    const alive = overlap(firstT, aliveEnd, from, to);
    if (green + yellow + red <= 0 && alive <= 0) continue;
    rows.push({ id, name, host, green, yellow, red, alive, active, lastSeen: aliveEnd });
  }

  rows.sort((a, b) => b.alive - a.alive || b.lastSeen - a.lastSeen);
  return rows;
}
