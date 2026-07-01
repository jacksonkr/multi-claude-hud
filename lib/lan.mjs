// Secure LAN broadcast/discovery over UDP.
//
// Each packet is sealed with AES-256-GCM using a key derived (scrypt) from a
// shared passphrase that every device sets identically. This gives:
//   • confidentiality — only devices with the passphrase can read the payload
//   • authenticity/integrity — forged or tampered packets fail the GCM tag and
//     are dropped, so a stranger on the LAN can't read or spoof your terminals.
//
// We use directed subnet broadcast (send to each NIC's broadcast address plus
// loopback) rather than multicast — far more reliable on multi-homed hosts
// (Wi-Fi + WSL + Docker virtual adapters) where the default multicast interface
// is ambiguous. Broadcasting is opt-in (a setting); receiving is harmless.

import dgram from "node:dgram";
import os from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Default port. Kept below the ephemeral range (49152+) and clear of the
// Hyper-V/WSL reserved blocks that sit in the 40k–48k range on Windows.
export const LAN_PORT = 41234;

// Subnet broadcast address for every non-internal IPv4 interface, plus loopback
// so other processes on this same machine also receive it.
function broadcastTargets() {
  const targets = new Set(["127.0.0.1"]);
  const nics = os.networkInterfaces();
  for (const list of Object.values(nics)) {
    for (const ni of list || []) {
      if (ni.family !== "IPv4" || ni.internal || !ni.netmask) continue;
      const ip = ni.address.split(".").map(Number);
      const mask = ni.netmask.split(".").map(Number);
      if (ip.length !== 4 || mask.length !== 4) continue;
      targets.add(ip.map((o, i) => (o & mask[i]) | (~mask[i] & 255)).join("."));
    }
  }
  return [...targets];
}
const MAGIC = Buffer.from("MCH1"); // quick reject of unrelated traffic
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER = MAGIC.length + IV_LEN + TAG_LEN; // 32 bytes

// Same passphrase → same key on every device (fixed salt).
export function deriveKey(passphrase) {
  if (!passphrase) return null;
  return scryptSync(String(passphrase), "multi-claude-hud-lan-v1", 32);
}

// Encrypt + authenticate an object into a single datagram buffer.
export function seal(key, obj) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(obj), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ct]);
}

// Verify + decrypt a datagram. Returns the object, or null if it isn't ours /
// the key is wrong / it was tampered with.
export function open(key, buf) {
  try {
    if (!key || buf.length < HEADER || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
    const iv = buf.subarray(MAGIC.length, MAGIC.length + IV_LEN);
    const tag = buf.subarray(MAGIC.length + IV_LEN, HEADER);
    const ct = buf.subarray(HEADER);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString("utf8"));
  } catch {
    return null; // bad key, tampered, or malformed
  }
}

export function createBroadcaster({ key, port = LAN_PORT } = {}) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("error", () => {});
  sock.bind(() => {
    try {
      sock.setBroadcast(true);
    } catch {}
  });
  return {
    send(obj) {
      if (!key) return;
      try {
        const msg = seal(key, obj);
        for (const target of broadcastTargets()) sock.send(msg, port, target);
      } catch {}
    },
    close() {
      try {
        sock.close();
      } catch {}
    },
  };
}

export function createListener({ key, port = LAN_PORT, onMessage } = {}) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("error", () => {});
  sock.on("message", (buf, rinfo) => {
    const obj = open(key, buf);
    if (obj) {
      try {
        onMessage?.(obj, rinfo);
      } catch {}
    }
  });
  sock.bind(port); // 0.0.0.0:port receives broadcasts on any interface
  return {
    close() {
      try {
        sock.close();
      } catch {}
    },
  };
}
