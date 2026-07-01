// Preload bridge shared by the overlay and the settings window.
// Exposes a tiny, safe `window.hud` API over IPC (context-isolated).

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hud", {
  // Read current settings once (returns a Promise).
  getSettings: () => ipcRenderer.invoke("hud:get"),
  // Subscribe to live settings pushes from the main process.
  onSettings: (cb) => ipcRenderer.on("hud:settings", (_e, s) => cb(s)),
  // Subscribe to the live terminal list (settings window uses this).
  onSessions: (cb) => ipcRenderer.on("hud:sessions", (_e, list) => cb(list)),
  // Window-relative cursor position (or null when outside), polled by main —
  // used for hover detection on the click-through overlay.
  onCursor: (cb) => ipcRenderer.on("hud:cursor", (_e, pt) => cb(pt)),
  // Toggle whether the overlay window passes mouse events through.
  setClickThrough: (on) => ipcRenderer.send("hud:setClickThrough", on),
  // Session updates from the main process (local scan + LAN peers): same
  // {type:'update'|'remove'|'snapshot'} shapes the SSE stream uses.
  onData: (cb) => ipcRenderer.on("hud:data", (_e, msg) => cb(msg)),
  // Apply a partial settings change.
  update: (partial) => ipcRenderer.send("hud:update", partial),
  // The overlay pushes its current terminal list up to the main process so the
  // tray's Favorites submenu and the settings window can show them.
  sendSessions: (list) => ipcRenderer.send("hud:sessions", list),
  openSettings: () => ipcRenderer.send("hud:openSettings"),
});
