// The overlay's networking engine. It:
//   • scans THIS machine's terminals locally,
//   • on Windows, also scans every running WSL distro via pass-through,
//   • (opt-in, encrypted) broadcasts all of the above to the LAN, and
//   • always listens for other devices' broadcasts.
// It emits the same `update`/`remove` messages the renderer already
// understands, so the overlay works with or without a hub.

import os from "node:os";
import { scanLocal } from "../lib/localscan.mjs";
import { scanAllWsl } from "../lib/wsl.mjs";
import { reconcile, removeHost } from "../lib/record.mjs";
import { deriveKey, createBroadcaster, createListener } from "../lib/lan.mjs";

const SCAN_MS = 3000;
const PEER_TIMEOUT_MS = 15000;

export function createNetEngine({ onData }) {
  const store = new Map(); // id -> record (local + WSL + all LAN peers)
  const SELF = process.env.CLAUDE_HUD_NAME || os.hostname();
  const localBase = { user: os.userInfo().username, platform: process.platform };

  let settings = { lanBroadcast: false, lanListen: true, lanKey: "" };
  let key = null;
  let broadcaster = null;
  let listener = null;
  let scanTimer = null;
  let sweepTimer = null;
  let scanning = false;

  let localHosts = new Set(); // hosts produced by local+WSL scanning last cycle
  const peerLastSeen = new Map();
  const peerLastT = new Map();
  const peerHosts = new Map(); // peer "from" -> Set(host) it has reported

  const emit = (msg) => {
    try {
      onData(msg);
    } catch {}
  };

  function applyHostSnapshot(host, sessions, ctx, now) {
    const { updates, removed } = reconcile(store, host, sessions, ctx, now);
    for (const session of updates) emit({ type: "update", session });
    for (const id of removed) emit({ type: "remove", id });
  }

  async function gatherLocal() {
    const groups = [];
    try {
      groups.push({ host: SELF, sessions: await scanLocal() });
    } catch {
      groups.push({ host: SELF, sessions: [] });
    }
    let wsl = [];
    try {
      wsl = await scanAllWsl();
    } catch {}
    for (const { distro, sessions } of wsl) groups.push({ host: `${SELF}/${distro}`, sessions });
    return groups;
  }

  async function scanTick() {
    if (scanning) return;
    scanning = true;
    try {
      const now = Date.now();
      const groups = await gatherLocal();
      const current = new Set(groups.map((g) => g.host));
      // A host (e.g. a WSL distro) that vanished this cycle: clear its sessions.
      for (const h of localHosts) {
        if (!current.has(h)) for (const id of removeHost(store, h, "local")) emit({ type: "remove", id });
      }
      localHosts = current;
      for (const g of groups) {
        applyHostSnapshot(g.host, g.sessions, { ...localBase, source: "local" }, now);
      }
      if (settings.lanBroadcast && key && broadcaster) {
        broadcaster.send({
          from: SELF,
          t: now,
          hosts: groups.map((g) => ({ host: g.host, ...localBase, sessions: g.sessions })),
        });
      }
    } finally {
      scanning = false;
    }
  }

  function onLan(obj) {
    if (!obj || obj.from === SELF || !Array.isArray(obj.hosts)) return;
    const prevT = peerLastT.get(obj.from);
    if (prevT && obj.t && obj.t <= prevT) return; // de-dupe duplicate datagrams
    peerLastT.set(obj.from, obj.t || Date.now());
    peerLastSeen.set(obj.from, Date.now());

    let known = peerHosts.get(obj.from);
    if (!known) peerHosts.set(obj.from, (known = new Set()));
    const incoming = new Set();
    const now = Date.now();
    for (const h of obj.hosts) {
      if (!h || !h.host) continue;
      incoming.add(h.host);
      known.add(h.host);
      applyHostSnapshot(h.host, h.sessions || [], { user: h.user, platform: h.platform, source: "lan" }, now);
    }
    // A host this peer used to report but didn't this time: clear it.
    for (const h of [...known]) {
      if (!incoming.has(h)) {
        for (const id of removeHost(store, h, "lan")) emit({ type: "remove", id });
        known.delete(h);
      }
    }
  }

  function sweepPeers() {
    const cutoff = Date.now() - PEER_TIMEOUT_MS;
    for (const [from, seen] of peerLastSeen) {
      if (seen < cutoff) {
        for (const h of peerHosts.get(from) || []) {
          for (const id of removeHost(store, h, "lan")) emit({ type: "remove", id });
        }
        peerHosts.delete(from);
        peerLastSeen.delete(from);
        peerLastT.delete(from);
      }
    }
  }

  function restartLan() {
    if (broadcaster) broadcaster.close();
    if (listener) listener.close();
    broadcaster = listener = null;
    key = deriveKey(settings.lanKey);
    if (key && settings.lanListen) listener = createListener({ key, onMessage: onLan });
    if (key && settings.lanBroadcast) broadcaster = createBroadcaster({ key });
  }

  return {
    snapshot: () => [...store.values()],
    applySettings(s) {
      settings = {
        lanBroadcast: !!s.lanBroadcast,
        lanListen: s.lanListen !== false,
        lanKey: s.lanKey || "",
      };
      restartLan();
    },
    start() {
      scanTick();
      scanTimer = setInterval(scanTick, SCAN_MS);
      sweepTimer = setInterval(sweepPeers, 5000);
    },
    stop() {
      clearInterval(scanTimer);
      clearInterval(sweepTimer);
      if (broadcaster) broadcaster.close();
      if (listener) listener.close();
    },
  };
}
