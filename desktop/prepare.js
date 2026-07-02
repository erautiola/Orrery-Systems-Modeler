"use strict";
/* Stage the server + public frontend into ./resources and install the server's
 * production dependencies, so electron-builder can bundle a self-contained app.
 * The server keeps its `../public` relationship (resources/server + resources/public). */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const res = path.join(__dirname, "resources");

fs.rmSync(res, { recursive: true, force: true });
fs.mkdirSync(res, { recursive: true });

// frontend
fs.cpSync(path.join(root, "public"), path.join(res, "public"), { recursive: true });

// server sources (no node_modules / tests)
fs.mkdirSync(path.join(res, "server"), { recursive: true });
for (const f of ["server.js", "store.js", "package.json", "package-lock.json"]) {
  fs.copyFileSync(path.join(root, "server", f), path.join(res, "server", f));
}

// production deps for the bundled server (express)
execSync("npm ci --omit=dev", { cwd: path.join(res, "server"), stdio: "inherit" });

console.log("Desktop resources prepared at", res);
