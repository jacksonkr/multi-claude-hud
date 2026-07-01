#!/usr/bin/env node
// Generates the program icon (dependency-free PNG encoder) at two sizes:
//   overlay/icon.png  (256px) — tray + taskbar at runtime
//   build/icon.png    (1024px) — source for the installers (electron-builder
//                                derives .ico/.icns from it)
//
// The icon: a dark rounded panel with three stacked status lights
// (green / yellow / red) and label bars — a tiny picture of the HUD itself.

import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function renderPng(N) {
  const s = N / 256; // layout is authored at 256px; scale everything by s
  const rgba = Buffer.alloc(N * N * 4); // transparent

  function blend(x, y, r, g, b, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4;
    const da = rgba[i + 3] / 255;
    const outA = a + da * (1 - a);
    if (outA <= 0) {
      rgba[i + 3] = 0;
      return;
    }
    rgba[i] = Math.round((r * a + rgba[i] * da * (1 - a)) / outA);
    rgba[i + 1] = Math.round((g * a + rgba[i + 1] * da * (1 - a)) / outA);
    rgba[i + 2] = Math.round((b * a + rgba[i + 2] * da * (1 - a)) / outA);
    rgba[i + 3] = Math.round(outA * 255);
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function sdRoundRect(px, py, cx, cy, hw, hh, r) {
    const qx = Math.abs(px - cx) - (hw - r);
    const qy = Math.abs(py - cy) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  }

  function fillRoundRect(cx, cy, hw, hh, r, col) {
    for (let y = Math.floor(cy - hh - 1); y <= cy + hh + 1; y++) {
      for (let x = Math.floor(cx - hw - 1); x <= cx + hw + 1; x++) {
        const cov = clamp01(0.5 - sdRoundRect(x + 0.5, y + 0.5, cx, cy, hw, hh, r));
        if (cov > 0) blend(x, y, col[0], col[1], col[2], cov * (col[3] ?? 1));
      }
    }
  }

  function fillCircle(cx, cy, rad, col, glow) {
    const gw = 6 * s;
    const R = rad + (glow ? gw : 1);
    for (let y = Math.floor(cy - R); y <= cy + R; y++) {
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (glow && d > rad) {
          const g = clamp01(1 - (d - rad) / gw) * 0.35;
          if (g > 0) blend(x, y, col[0], col[1], col[2], g);
        }
        const cov = clamp01(0.5 - (d - rad));
        if (cov > 0) blend(x, y, col[0], col[1], col[2], cov);
      }
    }
  }

  const panel = [18, 22, 29, 1];
  const border = [40, 48, 60, 1];
  const bar = [139, 151, 167, 0.85];
  const green = [46, 204, 64, 1];
  const yellow = [255, 210, 30, 1];
  const red = [255, 59, 48, 1];

  fillRoundRect(N / 2, N / 2, 110 * s, 110 * s, 40 * s, border);
  fillRoundRect(N / 2, N / 2, 106 * s, 106 * s, 37 * s, panel);

  const rows = [
    { cy: 86, col: green, barW: 92 },
    { cy: 134, col: yellow, barW: 74 },
    { cy: 182, col: red, barW: 58 },
  ];
  const dotX = 92 * s;
  for (const { cy, col, barW } of rows) {
    fillCircle(dotX, cy * s, 17 * s, col, true);
    fillRoundRect(dotX + (30 + barW / 2) * s, cy * s, (barW / 2) * s, 9 * s, 9 * s, bar);
  }

  return encodePng(N, rgba);
}

// --- minimal PNG encoder ---
function encodePng(N, rgba) {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((N * 4 + 1) * N);
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    rgba.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, y * N * 4 + N * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function write(outPath, N) {
  const png = renderPng(N);
  writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${N}x${N}, ${png.length} bytes)`);
}

write(join(__dirname, "icon.png"), 256); // tray / taskbar
mkdirSync(join(ROOT, "build"), { recursive: true });
write(join(ROOT, "build", "icon.png"), 1024); // installer source
