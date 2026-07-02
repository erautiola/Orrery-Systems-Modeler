"use strict";
/* Electron main process: start Orrery's built-in server on a random local port,
 * then show the app in a native window (its own window — not the user's browser).
 * Projects are stored under the OS per-user app-data directory. */
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

// where the staged server + public live (see prepare.js)
const base = app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "resources");

process.env.DATA_DIR = process.env.DATA_DIR || path.join(app.getPath("userData"), "projects");
process.env.PORT = "0"; // let the OS pick a free port

let win, server;

async function boot() {
  const { start } = require(path.join(base, "server", "server.js"));
  server = await start(0);
  const port = server.address().port;

  win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: "#0f1420",
    title: "Orrery Systems Modeler", autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  // open external links in the real browser, not inside the app window
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(boot).catch((e) => { console.error("Failed to start:", e); app.quit(); });
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
