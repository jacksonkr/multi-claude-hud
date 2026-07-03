// Multi-Claude HUD — desktop overlay (Electron main process).
//
// A frameless, transparent, always-on-top, click-through window pinned to a
// corner of the primary display, showing one status light per Claude terminal:
//   • green  — actively working
//   • yellow — stopped (idle), less than the red threshold ago
//   • red    — stopped for the red threshold (default 5 min) or longer
//
// Everything is driven from the tray ("quick-launch") icon: opacity, sort
// order, favorites (pinned to top), and a full Settings window. Settings
// persist across restarts in the app's userData folder.

const {
  app,
  BrowserWindow,
  screen,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

let net = null; // LAN/local networking engine (loaded after app ready)

// ---- Settings (persisted) -------------------------------------------------

const SETTINGS_PATH = path.join(app.getPath("userData"), "hud-settings.json");

const SORT_MODES = ["status", "alpha", "lifetime", "recent"];
const SORT_LABELS = {
  status: "Status (working first)",
  alpha: "Name (A–Z)",
  lifetime: "Lifetime (oldest first)",
  recent: "Last active",
};

const DEFAULTS = {
  opacity: 0.6,
  hoverOpaque: true, // lift a chip to 100% while the mouse is over it
  hoverZoom: 200, // how big the panel grows on hover, in percent
  corner: "top-right", // top-right | top-left | bottom-right | bottom-left
  sortMode: "status",
  soundMode: "off", // off | any | waiting (→ yellow) | done (→ red)
  soundScope: "all", // all | favorites — which lights may chime
  soundVolume: 100, // chime loudness in percent (0–200)
  favorites: [], // stable keys "host::name" pinned to the top
  hidden: [], // stable keys hidden from the overlay
  // LAN sharing (secure, opt-in). Off by default; broadcasting needs a key.
  lanBroadcast: false,
  lanListen: true,
  lanKey: "",
};

// The window is kept large and transparent so the panel can zoom on hover (up
// to ~300%) without being clipped; only the panel's pixels are ever visible.
const WIN_W = 620;
const WIN_H = 1000;
const WIN_MARGIN = 14;

function readHubFromConfig() {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "hud.config.json"), "utf8")
    );
    if (cfg.hub) return cfg.hub;
  } catch {
    /* none */
  }
  return null;
}
const HUB = process.env.CLAUDE_HUD_URL || readHubFromConfig() || "http://localhost:4500";

let settings = { ...DEFAULTS };
function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) };
  } catch {
    settings = { ...DEFAULTS };
  }
  // Env overrides (first run convenience).
  if (process.env.CLAUDE_HUD_OPACITY) settings.opacity = Number(process.env.CLAUDE_HUD_OPACITY);
  if (process.env.CLAUDE_HUD_CORNER) settings.corner = process.env.CLAUDE_HUD_CORNER;
  clampSettings();
}
function clampSettings() {
  settings.opacity = Math.min(1, Math.max(0.1, Number(settings.opacity) || 0.6));
  if (!SORT_MODES.includes(settings.sortMode)) settings.sortMode = "status";
  if (!["off", "any", "waiting", "done"].includes(settings.soundMode)) settings.soundMode = "off";
  if (!["all", "favorites"].includes(settings.soundScope)) settings.soundScope = "all";
  const vol = Number(settings.soundVolume);
  settings.soundVolume = Number.isFinite(vol) ? Math.min(200, Math.max(0, vol)) : 100;
  if (!Array.isArray(settings.favorites)) settings.favorites = [];
  if (!Array.isArray(settings.hidden)) settings.hidden = [];
  settings.hoverOpaque = settings.hoverOpaque !== false;
  settings.hoverZoom = Math.min(400, Math.max(100, Number(settings.hoverZoom) || 200));
  settings.lanBroadcast = !!settings.lanBroadcast;
  settings.lanListen = settings.lanListen !== false;
  settings.lanKey = String(settings.lanKey || "");
}
function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch {
    /* best effort */
  }
}

// Apply a partial settings change from anywhere (tray or settings window).
function updateSettings(partial) {
  settings = { ...settings, ...partial };
  clampSettings();
  saveSettings();
  applyToOverlay();
  if (net) net.applySettings(settings);
  broadcastSettings();
  buildTray();
}

// ---- Windows --------------------------------------------------------------

let win = null; // the overlay
let settingsWin = null;
let historyWin = null;
let tray = null;
let clickThrough = true;
let sessionCache = []; // [{key,name,host}] pushed from the overlay renderer

const iconPath = path.join(__dirname, "icon.png");
function appIcon() {
  const img = nativeImage.createFromPath(iconPath);
  return img.isEmpty() ? undefined : img;
}

function positionFor(display) {
  const wa = display.workArea;
  const w = WIN_W, h = WIN_H, margin = WIN_MARGIN, corner = settings.corner;
  const left = wa.x + margin;
  const right = wa.x + wa.width - w - margin;
  const top = wa.y + margin;
  const bottom = wa.y + wa.height - h - margin;
  switch (corner) {
    case "top-left":
      return { x: left, y: top };
    case "bottom-left":
      return { x: left, y: bottom };
    case "bottom-right":
      return { x: right, y: bottom };
    default:
      return { x: right, y: top };
  }
}

function createOverlay() {
  const display = screen.getPrimaryDisplay();
  const { x, y } = positionFor(display);

  win = new BrowserWindow({
    x,
    y,
    width: WIN_W,
    height: WIN_H,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    // A background overlay: not focusable, so it stays out of the taskbar and
    // Alt-Tab and never steals focus. It can still receive the intercept click
    // (mouse events don't require activation).
    focusable: false,
    show: false,
    icon: appIcon(),
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required", // allow the alert chime
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // The window stays fully opaque; the configured opacity is applied per-item
  // in CSS so a hovered chip can rise to 100%.
  win.setOpacity(1);
  win.setIgnoreMouseEvents(clickThrough, { forward: true });

  if (process.env.CLAUDE_HUD_DEBUG) {
    win.webContents.on("console-message", (_e, _l, msg) => console.log("[overlay]", msg));
    win.webContents.on("render-process-gone", (_e, d) => console.log("[overlay gone]", d.reason));
  }

  win.loadFile(path.join(__dirname, "overlay.html"), {
    query: { hub: HUB },
  });
  win.once("ready-to-show", () => win.showInactive()); // never steal focus

  // (Re)send the current local + LAN sessions to the renderer on each load.
  win.webContents.on("did-finish-load", () => {
    if (!net) return;
    for (const session of net.snapshot()) win.webContents.send("hud:data", { type: "update", session });
  });

  const reposition = () => win && win.setBounds({ ...positionFor(screen.getPrimaryDisplay()), width: WIN_W, height: WIN_H });
  screen.on("display-metrics-changed", reposition);
  screen.on("display-added", reposition);
  screen.on("display-removed", reposition);

  startCursorTracking();
}

// The overlay is permanently click-through, so it can't rely on DOM mouse
// events for hover. Instead the main process polls the global cursor position
// and tells the renderer where the cursor is *relative to the window* (or null
// when outside). The renderer hit-tests that point against the chips. This
// never captures clicks — pass-through is fully preserved.
let cursorTimer = null;
function startCursorTracking() {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    let p, b;
    try {
      p = screen.getCursorScreenPoint();
      b = win.getBounds();
    } catch {
      return;
    }
    const inside =
      p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    win.webContents.send("hud:cursor", inside ? { x: p.x - b.x, y: p.y - b.y } : null);
  }, 40);
  if (cursorTimer.unref) cursorTimer.unref();
}

function applyToOverlay() {
  if (!win) return;
  // Opacity is applied in the renderer (per-item); just keep the geometry.
  win.setBounds({ ...positionFor(screen.getPrimaryDisplay()), width: WIN_W, height: WIN_H });
}

function broadcastSettings() {
  for (const w of [win, settingsWin, historyWin]) {
    if (w && !w.isDestroyed()) w.webContents.send("hud:settings", settings);
  }
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 440,
    height: 600,
    title: "Multi-Claude HUD — Settings",
    icon: appIcon(),
    resizable: true,
    minimizable: true,
    fullscreenable: false,
    backgroundColor: "#0e1116",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
  settingsWin.once("ready-to-show", () => {
    settingsWin.webContents.send("hud:sessions", sessionCache);
    settingsWin.webContents.send("hud:settings", settings);
  });
  settingsWin.on("closed", () => (settingsWin = null));
}

function openHistory() {
  if (historyWin && !historyWin.isDestroyed()) {
    historyWin.show();
    historyWin.focus();
    return;
  }
  historyWin = new BrowserWindow({
    width: 560,
    height: 640,
    title: "Multi-Claude HUD — Activity",
    icon: appIcon(),
    resizable: true,
    fullscreenable: false,
    backgroundColor: "#0e1116",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  historyWin.setMenuBarVisibility(false);
  historyWin.loadFile(path.join(__dirname, "history.html"), {
    query: { hub: HUB },
  });
  historyWin.once("ready-to-show", () =>
    historyWin.webContents.send("hud:settings", settings)
  );
  historyWin.on("closed", () => (historyWin = null));
}

// ---- Tray -----------------------------------------------------------------

function trayImage() {
  const img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) return img;
  return img.resize({ width: 18, height: 18, quality: "best" });
}

function toggleFavorite(key) {
  const favs = new Set(settings.favorites);
  favs.has(key) ? favs.delete(key) : favs.add(key);
  updateSettings({ favorites: [...favs] });
}

function buildTray() {
  if (!tray) {
    try {
      tray = new Tray(trayImage());
    } catch {
      return;
    }
    tray.setToolTip("Multi-Claude HUD");
    tray.on("click", openSettings); // left-click opens settings
  }

  const favSet = new Set(settings.favorites);
  const favItems = sessionCache.length
    ? sessionCache.map((s) => ({
        label: s.name + (s.host ? `  ·  ${s.host}` : ""),
        type: "checkbox",
        checked: favSet.has(s.key),
        click: () => toggleFavorite(s.key),
      }))
    : [{ label: "No terminals reporting", enabled: false }];

  const opacityItems = [10, 25, 40, 60, 80, 100].map((pct) => ({
    label: `${pct}%`,
    type: "radio",
    checked: Math.round(settings.opacity * 100) === pct,
    click: () => updateSettings({ opacity: pct / 100 }),
  }));

  const sortItems = SORT_MODES.map((m) => ({
    label: SORT_LABELS[m],
    type: "radio",
    checked: settings.sortMode === m,
    click: () => updateSettings({ sortMode: m }),
  }));

  const menu = Menu.buildFromTemplate([
    { label: "Settings…", click: openSettings },
    { label: "Activity history…", click: openHistory },
    { type: "separator" },
    { label: "Favorites (pin to top)", submenu: favItems },
    { label: "Sort others by", submenu: sortItems },
    { label: "Opacity", submenu: opacityItems },
    { type: "separator" },
    {
      label: "Opaque on mouse-over",
      type: "checkbox",
      checked: settings.hoverOpaque,
      click: (item) => updateSettings({ hoverOpaque: item.checked }),
    },
    { label: "Reload overlay", click: () => win && win.reload() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---- IPC ------------------------------------------------------------------

ipcMain.handle("hud:get", () => settings);
ipcMain.on("hud:update", (_e, partial) => updateSettings(partial || {}));
ipcMain.on("hud:setClickThrough", (_e, on) => {
  clickThrough = on !== false;
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(clickThrough, { forward: true });
});
ipcMain.on("hud:sessions", (_e, list) => {
  sessionCache = Array.isArray(list) ? list : [];
  buildTray();
  if (settingsWin && !settingsWin.isDestroyed())
    settingsWin.webContents.send("hud:sessions", sessionCache);
});
ipcMain.on("hud:openSettings", openSettings);

// ---- Lifecycle ------------------------------------------------------------

app.whenReady().then(async () => {
  loadSettings();
  if (process.platform === "darwin" && app.dock) {
    const i = appIcon();
    if (i) app.dock.setIcon(i);
    app.dock.hide();
  }
  createOverlay();
  buildTray();
  await initNet();
});

// Load the ESM networking engine and start scanning + (opt-in) LAN sharing.
async function initNet() {
  try {
    const { createNetEngine } = await import(pathToFileURL(path.join(__dirname, "net.mjs")).href);
    net = createNetEngine({
      onData: (msg) => {
        if (win && !win.isDestroyed()) win.webContents.send("hud:data", msg);
      },
    });
    net.applySettings(settings);
    net.start();
  } catch (e) {
    console.error("net engine failed to start:", e?.message || e);
  }
}

app.on("window-all-closed", () => {
  /* keep running in the tray */
});
app.on("activate", () => {
  if (!win) createOverlay();
});
