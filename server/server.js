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
const { UserStore } = require("./users");
const { SessionStore } = require("./sessions");

const PORT = process.env.PORT || 8137;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const AUTH_DIR = path.join(DATA_DIR, ".auth"); // kept out of the project library
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Auth is OFF by default so existing single-team installs keep working on
// upgrade. Set AUTH_REQUIRED=1 to require a login for the API.
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "1";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1"; // set behind HTTPS
const SID = "osm_sid";

const store = new Store(DATA_DIR);
const users = new UserStore(AUTH_DIR);
const sessions = new SessionStore(AUTH_DIR);
const app = express();
app.use(express.json({ limit: "32mb" }));

// --- rate limiting (per IP) ----------------------------------------------
const rateLimit = require("express-rate-limit");
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 600, // requests / minute / IP
  standardHeaders: true,
  legacyHeaders: false,
}));

// --- tiny request logger -------------------------------------------------
app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) {
    // strip newlines so a crafted path can't forge log lines
    const safePath = String(req.path).replace(/[\r\n]/g, "");
    console.log(`${req.method} ${safePath}`);
  }
  next();
});

// --- authentication -------------------------------------------------------
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSid(res, id) {
  res.setHeader("Set-Cookie", `${SID}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}${COOKIE_SECURE ? "; Secure" : ""}`);
}
function clearSid(res) {
  res.setHeader("Set-Cookie", `${SID}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${COOKIE_SECURE ? "; Secure" : ""}`);
}
// resolve the current user from the session cookie (always runs)
app.use((req, _res, next) => {
  req.user = null;
  const sid = parseCookies(req)[SID];
  const sess = sid && sessions.get(sid);
  if (sess) {
    const u = users.byId(sess.userId);
    if (u && u.status === "active") { req.user = users.pub(u); req._sid = sid; }
  }
  next();
});

// stricter limiter on login to slow credential-stuffing
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: Number(process.env.LOGIN_RATE_MAX) || 20, standardHeaders: true, legacyHeaders: false });

const auth = express.Router();
auth.get("/me", (req, res) => res.json({ authRequired: AUTH_REQUIRED, user: req.user }));
auth.post("/login", loginLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await users.login(username, password);
  const sid = await sessions.create(user.id);
  setSid(res, sid);
  res.json({ user });
}));
auth.post("/logout", wrap(async (req, res) => {
  if (req._sid) await sessions.destroy(req._sid);
  clearSid(res);
  res.status(204).end();
}));
app.use("/api/auth", auth);

// when auth is required, guard every other /api route
app.use("/api", (req, res, next) => {
  if (!AUTH_REQUIRED) return next();
  if (req.path === "/health" || req.path.startsWith("/auth")) return next();
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
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
  await users.init();
  await sessions.init();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const addr = server.address();
      console.log(`Orrery Systems Modeler running on http://localhost:${addr.port}`);
      console.log(`Project library: ${DATA_DIR}`);
      console.log(`Auth: ${AUTH_REQUIRED ? "required" : "open (set AUTH_REQUIRED=1 to enforce)"}`);
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

module.exports = { app, store, users, sessions, start };
