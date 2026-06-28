/* ============================================================================
 * server.js — Express server for the multi-user UML/SysML modeler.
 *
 * Responsibilities:
 *   - serve the single-page frontend from /public
 *   - expose a small REST API over the shared project library (server/store.js)
 *
 * XMI import/export is done in the browser (it has a DOM parser/serializer);
 * the server only stores the resulting internal JSON model, which keeps it
 * dependency-light and OS-agnostic. Run anywhere Node runs, or via Docker.
 * ==========================================================================*/
"use strict";
const path = require("path");
const express = require("express");
const { Store } = require("./store");

const PORT = process.env.PORT || 8137;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const store = new Store(DATA_DIR);
const app = express();
app.use(express.json({ limit: "32mb" }));

// --- tiny request logger -------------------------------------------------
app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) console.log(`${req.method} ${req.path}`);
  next();
});

// --- API ------------------------------------------------------------------
const api = express.Router();

api.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

api.get("/projects", wrap(async (_req, res) => {
  res.json(await store.list());
}));

api.post("/projects", wrap(async (req, res) => {
  const { name, model } = req.body || {};
  const p = await store.create(name, model);
  res.status(201).json(p);
}));

api.get("/projects/:id", wrap(async (req, res) => {
  res.json(await store.get(req.params.id));
}));

api.put("/projects/:id", wrap(async (req, res) => {
  const { name, model, rev } = req.body || {};
  res.json(await store.save(req.params.id, { name, model, rev }));
}));

api.patch("/projects/:id", wrap(async (req, res) => {
  res.json(await store.rename(req.params.id, (req.body || {}).name));
}));

api.delete("/projects/:id", wrap(async (req, res) => {
  await store.remove(req.params.id);
  res.status(204).end();
}));

app.use("/api", api);

// --- static frontend ------------------------------------------------------
app.use(express.static(PUBLIC_DIR));
// SPA fallback for any non-API GET
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// --- error handler --------------------------------------------------------
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Server error" });
});

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Initialize the store and start listening. Returns a Promise<http.Server>
// that resolves once the server is accepting connections (handy for tests).
async function start(port = PORT) {
  await store.init();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const addr = server.address();
      console.log(`Orrery Systems Modeler running on http://localhost:${addr.port}`);
      console.log(`Project library: ${DATA_DIR}`);
      resolve(server);
    });
  });
}

// only auto-start when run directly (`node server.js`), not when imported by tests
if (require.main === module) {
  start().catch((e) => {
    console.error("Failed to start:", e);
    process.exit(1);
  });
}

module.exports = { app, store, start };
