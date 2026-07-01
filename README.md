# Multi-Claude HUD

[![CI](https://github.com/jacksonkr/multi-claude-hud/actions/workflows/ci.yml/badge.svg)](https://github.com/jacksonkr/multi-claude-hud/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A floating, always-on-top **desktop overlay** showing the live status of every Claude Code terminal across all your machines (Windows + Mac on the same LAN). It sits in the corner of your primary display at 60% opacity, over the top of whatever you're doing, with **one light per terminal**:

- 🟢 **green** — actively working
- 🟡 **yellow** — stopped working (idle)
- 🔴 **red** — stopped for **5 minutes or longer**

```
                                          ┌──────────────────┐  ← top-right corner,
                                          │ ● claude    3    │    60% opacity,
                                          ├──────────────────┤    always on top,
                                          │  api-server   🟢 │    click-through
                                          │  jackson-mac     │
                                          ├──────────────────┤
                                          │  trainer      🟢 │
                                          │  studio-mini     │
                                          ├──────────────────┤
                                          │  frontend     🔴 │
                                          │  jackson-pc      │
                                          └──────────────────┘
```

## Install

Grab the installer for your OS from the [Releases](https://github.com/jacksonkr/multi-claude-hud/releases) page:

- **Windows** — `Multi-Claude HUD Setup x.y.z.exe` (NSIS installer)
- **macOS** — `Multi-Claude HUD-x.y.z.dmg` (or the `.zip`)
- **Linux** — `Multi-Claude HUD-x.y.z.AppImage` (or the `.deb`)

The installed app is the **overlay** — it scans this machine (and its WSL
distros) and does secure LAN sharing on its own, so on a single-network setup
you just install it on each device and set the same Network key. The **hub** is
optional (for cross-subnet aggregation + history) and runs from source.

Prefer running from source? See **Setup** below.

## How it works

Three pieces:

- **The hub** (`server.js`) — a tiny zero-dependency Node server. Run it on *one* machine. It aggregates the live state of every terminal in memory and streams it out.
- **The scanner** (`scanner.js`) — runs on every machine that has Claude terminals. It reads Claude Code's own per-session files in `~/.claude/sessions/`, keeps only the ones whose process is genuinely alive (PID running **and** its start time matches the session — which rules out PID reuse and stale leftovers), and reports the live set to the hub every few seconds. Because it reads presence directly, it sees **every** open terminal — including ones idle for hours — not just ones that happen to fire an event.
- **The overlay** (`overlay/`) — an Electron app that draws the always-on-top light panel. Run it on whichever machine(s) you want to *watch* the HUD from. It connects to the hub and renders the lights natively over everything else.

> There's also an optional browser dashboard at `http://<hub>:4500/` with fuller detail if you ever want it — but the overlay is the main UI.
>
> An older **hook**-based reporter (`hook-report.js` + `install-hooks.js`) is still in the repo as an alternative, but the scanner is preferred: it needs no `settings.json` changes and never misses idle terminals.

## Setup

### 1. Start the hub (on one machine)

```bash
npm install            # one-time: pulls in Electron for the overlay
node server.js
```

It prints its LAN address, e.g. `http://192.168.1.77:4500`.

> Optional: change the port with `CLAUDE_HUD_PORT=4500`.

### 2. Run the scanner (on every machine with Claude terminals)

```bash
node scanner.js --hub http://192.168.1.77:4500
```

It scans `~/.claude/sessions/` every few seconds and reports each live terminal
to the hub. Give the machine a friendly name (otherwise the hostname is used):

```bash
# macOS / Linux
CLAUDE_HUD_NAME="jackson-mac" node scanner.js --hub http://192.168.1.77:4500
# Windows (PowerShell)
$env:CLAUDE_HUD_NAME="jackson-pc"; node scanner.js --hub http://192.168.1.77:4500
```

On the machine running the hub you can omit `--hub` (defaults to `localhost:4500`):
`npm run scan`.

### 3. Run the overlay (on whichever machine you want to watch from)

```bash
npm run overlay
```

By default it connects to `http://localhost:4500`. To watch a hub on another
machine, set `CLAUDE_HUD_URL`:

```bash
# macOS / Linux
CLAUDE_HUD_URL=http://192.168.1.77:4500 npm run overlay
# Windows (PowerShell)
$env:CLAUDE_HUD_URL="http://192.168.1.77:4500"; npm run overlay
```

A small **green-dot tray icon** appears — right-click it to toggle click-through, reload, or quit.

> The overlay only *displays*. To see a machine's terminals you need the
> **scanner** running on that machine (step 2). One overlay shows everyone.

## What each light means

| Light       | Meaning                                                        |
|-------------|----------------------------------------------------------------|
| 🟢 **green**  | Actively working (thinking or running a tool)                  |
| 🟡 **yellow** | Stopped working (idle / finished / waiting on you)             |
| 🔴 **red**    | Hasn't worked for the red threshold (default **5 min**) or longer |

Lights are steady; a light flashes once only when its state actually changes.
Over each **red** light, the idle time is shown as a single coarse unit —
`10s`, `2m`, `1h`, `1d`, `3w`, `5mo`, `1y` (never compound). A light disappears
the moment its terminal is closed.

## The tray menu (quick-launch)

The app lives in your system tray (HUD icon). **Left-click** it to open Settings;
**right-click** for the quick menu:

- **Favorites** — ★ any terminal to pin it to the top of the overlay. Favorites
  are remembered by machine + name, so they survive restarts.
- **Sort others by** — Status (working first), Name, Lifetime (oldest first),
  or Last active.
- **Opacity** — quick presets (10–100%); the Settings window has a fine slider.
- **Opaque on mouse-over** — toggle the hover behavior described below.
- **Reload / Quit**.

### Hovering & click-to-reveal

The overlay is click-through, so it never gets in your way. When **Opaque on
mouse-over** is on:

1. Move the cursor into the perimeter around the panel → the **whole panel
   fades to 100% and zooms to 2×**.
2. **Click the CLAUDE header** → collapse the list to just the header (a small
   handle); click it again to expand.
3. **Click anywhere else on the panel** → the window captures that one click
   (it does *not* leak to what's behind), then the panel goes **fully
   transparent and click-through** so you can see and click whatever's behind
   it — until you move the cursor out of the perimeter, which resets everything.

Hover is detected by the main process polling the global cursor position, so it
works regardless of the click-through window (forwarded DOM hover doesn't). The
window is kept large and transparent so the 2× zoom never clips.

The **Settings window** gives a live opacity slider, corner picker, red-threshold
minutes, an "opaque on mouse-over" toggle, hover-zoom, sort mode, an **alert
sound** (a chime when a light changes — off, any change, on-stop, or on-red),
LAN sharing, and a list of every terminal you can ★ to favorite. All settings
persist in the app's user-data folder.

## Activity history

The hub keeps a persistent log (`history.jsonl`, ~8 days) of every terminal's
working↔idle transitions. Open **Activity history…** from the tray for a window
with a slider from **1 hour up to 1 week**: each terminal shows a green/yellow/red
bar and totals for how long it was alive, working (green), idle (yellow), and
idle past the red threshold (red) within the chosen window.

Only transitions are logged; the yellow/red split is derived at view time, so it
honours whatever red-threshold you've set. History survives hub restarts and
covers every machine the hub sees.

> The icon is generated (dependency-free) by `node overlay/make-icon.mjs` →
> `overlay/icon.png`; it already ships in the repo.

## Configuration (env vars)

**Hub** (`server.js`):
- `CLAUDE_HUD_PORT` — listen port (default `4500`)
- `CLAUDE_HUD_HOST` — bind address (default `0.0.0.0`, all interfaces)
- `CLAUDE_HUD_EVICT_MS` — silence before a session is dropped (default `1800000`)

**Scanner** (`scanner.js` / `npm run scan`):
- `CLAUDE_HUD_URL` — hub URL (or pass `--hub <url>`; default `http://localhost:4500`)
- `CLAUDE_HUD_NAME` — friendly machine name shown under each light
- `CLAUDE_HUD_SCAN_MS` — how often to scan for sessions (default `3000`)
- `CLAUDE_HUD_DEBUG` — set to log how many sessions were reported each cycle

**Overlay** (`npm run overlay`) — most of these are now adjustable live from the
tray/Settings and persisted; the env vars only seed the **first run**:
- `CLAUDE_HUD_URL` — hub URL to connect to (default `http://localhost:4500`)
- `CLAUDE_HUD_CORNER` — `top-right` (default), `top-left`, `bottom-right`, `bottom-left`
- `CLAUDE_HUD_OPACITY` — initial window opacity `0.1`–`1` (default `0.6`)
- `CLAUDE_HUD_RED_MS` — initial idle time before a light turns red (default `300000` = 5 min)

## Endpoints

- `GET /` — the optional browser dashboard
- `GET /events` — SSE live stream (the overlay subscribes here)
- `GET /api/state` — JSON snapshot of all sessions
- `GET /history?windowMs=&redMs=` — per-terminal green/yellow/red/alive totals over the window
- `POST /scan` — ingest a machine's live-session snapshot (from the scanner)
- `GET /healthz` — liveness + session count

## Notes & security

- This is meant for a **trusted LAN**. There's no auth; anyone who can reach the port can view the HUD and post sessions. Don't expose it to the public internet.
- All state is in memory — restart the hub and it repopulates on the scanners' next cycle (a few seconds).
- The scanner is read-only: it never touches your Claude sessions, only reads `~/.claude/sessions/` and process metadata.

## LAN sharing (secure, opt-in)

Instead of pointing scanners at a hub IP, devices can **discover each other on
the LAN** automatically. The overlay always scans the local machine, and (when
you opt in) broadcasts its terminals so any other device listening sees them —
no hub, no IP config, no per-host firewall rule.

Open the overlay's **Settings → LAN sharing** and on each device set the **same
Network key** (a passphrase), then:
- tick **Broadcast my terminals to this LAN** on devices you want to share *from*,
- keep **Show terminals other devices broadcast** on to display peers.

Security:
- Every packet is **AES-256-GCM** encrypted with a key derived (scrypt) from
  your passphrase. Devices without the passphrase can't read *or* forge packets;
  tampered/garbage packets fail the auth tag and are dropped.
- **Off by default.** Nothing leaves a machine unless you tick *Broadcast* and
  set a key. Meant for a trusted LAN.
- Transport is UDP directed-broadcast on port **41234** (configurable in code).
  If a device can't receive, allow inbound UDP 41234 through its firewall.

This is independent of the hub — you can use either or both.

## Auto-start on login

```bash
npm run autostart            # start hub + overlay at login
node autostart.mjs --no-hub  # overlay only (a view-only device)
npm run autostart:remove     # undo
```

Uses your OS's user-session login mechanism (Windows Startup folder, macOS
LaunchAgent, Linux XDG autostart) so the overlay window can appear.

## Platforms

- **Windows, macOS, Linux** are all supported — the overlay (Electron) and the
  scanner run natively on each. The "Unix path" in the scanner *is* the Linux
  build; a native Linux box or **virtual desktop** just runs `node scanner.js`
  or the overlay directly.
- **Same-subnet** is what LAN broadcast needs (UDP directed-broadcast doesn't
  cross routers/VLANs). VDIs/VMs on the same subnet see each other fine. Across
  subnets, run the **hub** (TCP, routable) and point devices at it instead.

## Multiple groups on one network (e.g. an office)

You don't need a pub/sub broker. The **Network key is the channel**: only devices
sharing the same passphrase can decrypt each other's packets, so different teams
with different keys are isolated automatically, and anyone without a key sees
nothing readable. Traffic is tiny (a small encrypted datagram every ~3s per
broadcasting device), so it scales to office sizes. If you need cross-subnet
reach or central control, use the hub instead of (or alongside) LAN broadcast.

## WSL (automatic)

On Windows, the overlay and the scanner **automatically pass through to WSL** —
they detect every running distro and scan it for you (via `wsl.exe -e node`
running the same scan logic inside the distro). WSL terminals show up tagged as
`<machine>/<distro>` (e.g. `desktop/Ubuntu`) with no setup inside WSL. Node must
be available in the distro (it usually is, since Claude runs on it).

A native Linux machine just runs `node scanner.js` (or the overlay) directly —
the Unix code path is the Linux version.

## Development

No build step and no runtime dependencies — everything uses Node built-ins
(Electron is only needed to run the overlay).

```bash
npm test          # unit + integration tests (node --test)
npm run check     # node --check every source file
npm run icon      # regenerate the icons
npm run dist      # build an installer for the current OS into dist/
```

Installers are produced by **electron-builder** (`electron-builder.yml`). CI
builds them on Windows/macOS/Linux and attaches them to each GitHub Release —
see *Releases* below. The overlay is the packaged app; `asar` is disabled so the
WSL pass-through's `scan-emit.mjs` stays a real file on disk.

Layout:

```
server.js          hub: HTTP + SSE + history (run on one machine)
scanner.js         per-machine presence reporter
overlay/           Electron overlay (main, preload, renderer, settings, history)
lib/               pure, unit-tested logic (derive, history, scan)
overlay/shared.mjs pure renderer helpers (shared with tests)
test/              node:test suites
```

Pure logic lives in `lib/` and `overlay/shared.mjs` so it can be unit-tested
without spinning up Electron; `server.js` exports `startHub()` for the
integration test.

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `chore:` …). Releases are automated with
[release-please](https://github.com/googleapis/release-please): merging
Conventional-Commit PRs into `main` keeps a release PR up to date with the next
version bump and `CHANGELOG.md`; merging that PR cuts a GitHub Release. CI runs
the test suite on Linux, macOS, and Windows across Node 20 and 22.

### Releases

1. Merge the release-please PR → it tags and publishes a GitHub Release.
2. The `build-release` workflow then builds installers on each OS and uploads
   them to that Release. (macOS builds are unsigned in CI.)

## License

[MIT](./LICENSE) © Jackson Rollins
