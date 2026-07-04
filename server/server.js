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
const fs = require("fs/promises");
const express = require("express");
const { Store } = require("./store");
const { UserStore, httpError } = require("./users");
const { SessionStore } = require("./sessions");
const { CmStore } = require("./cm");
const { LockStore } = require("./locks");
const Permissions = require(path.join(__dirname, "..", "public", "js", "permissions.js"));

const PORT = process.env.PORT || 8137;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const AUTH_DIR = path.join(DATA_DIR, ".auth"); // kept out of the project library
const CM_DIR = path.join(DATA_DIR, ".cm");     // version history + baselines
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Auth is OFF by default so existing single-team installs keep working on
// upgrade. Set AUTH_REQUIRED=1 to require a login for the API.
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "1";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1"; // set behind HTTPS
const SID = "osm_sid";

const store = new Store(DATA_DIR);
const users = new UserStore(AUTH_DIR);
const sessions = new SessionStore(AUTH_DIR);
const cm = new CmStore(CM_DIR);
const locks = new LockStore();
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
// read a single cookie by name — never writes a user-controlled value as an
// object key, so there is no prototype-pollution surface
function getCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
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
  const sid = getCookie(req, SID);
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

// per-project permission gate (only enforced when auth is required). Loads the
// project (404 if missing) and stashes it on req for the handler to reuse.
function requirePerm(action) {
  return wrap(async (req, _res, next) => {
    const project = await store.get(req.params.id); // throws 404 if absent
    if (AUTH_REQUIRED && !Permissions.can(req.user, action, project)) throw httpError(403, "You don't have permission to do that");
    req._project = project;
    next();
  });
}

api.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

// signed-in users may look up teammates (id + username only) to share projects
api.get("/users", wrap(async (req, res) => {
  res.json(users.list().map((u) => ({ id: u.id, username: u.username })));
}));

api.get("/projects", wrap(async (req, res) => {
  let list = await store.list();
  if (AUTH_REQUIRED) list = list.filter((p) => Permissions.can(req.user, "read", p));
  res.json(list);
}));

const who = (req) => (req.user && req.user.username) || null;

api.post("/projects", wrap(async (req, res) => {
  const { name, model } = req.body || {};
  const p = await store.create(name, model, req.user && req.user.id); // creator becomes owner
  await cm.recordVersion(p.id, { rev: p.rev, author: who(req), message: "Created", model: p.model });
  res.status(201).json(p);
}));

api.get("/projects/:id", requirePerm("read"), wrap(async (req, res) => {
  res.json(req._project);
}));

api.put("/projects/:id", requirePerm("write"), wrap(async (req, res) => {
  // exclusive editing: block if another user holds the edit lock, else (re)take it
  if (AUTH_REQUIRED && req.user) {
    const held = locks.get(req.params.id);
    if (held && held.userId !== req.user.id) throw httpError(423, `Locked for editing by ${held.username}`);
    locks.acquire(req.params.id, req.user);
  }
  const { name, model, rev, message } = req.body || {};
  const saved = await store.save(req.params.id, { name, model, rev });
  if (model != null) await cm.recordVersion(saved.id, { rev: saved.rev, author: who(req), message, model: saved.model });
  res.json(saved);
}));

// --- edit locks (check-out / check-in) ------------------------------------
api.get("/projects/:id/lock", requirePerm("read"), wrap(async (req, res) => {
  res.json({ lock: locks.get(req.params.id) });
}));
api.post("/projects/:id/lock", requirePerm("write"), wrap(async (req, res) => {
  if (!req.user) return res.json({ ok: true, lock: null }); // open mode: no locking
  const force = !!(req.body || {}).force && Permissions.can(req.user, "manage", req._project);
  res.json(locks.acquire(req.params.id, req.user, force));
}));
api.post("/projects/:id/lock/renew", requirePerm("write"), wrap(async (req, res) => {
  if (!req.user) return res.json({ ok: true, lock: null });
  res.json(locks.renew(req.params.id, req.user));
}));
api.delete("/projects/:id/lock", requirePerm("write"), wrap(async (req, res) => {
  if (req.user) {
    const force = String(req.query.force || "") === "1" && Permissions.can(req.user, "manage", req._project);
    locks.release(req.params.id, req.user, force);
  }
  res.status(204).end();
}));

api.patch("/projects/:id", requirePerm("manage"), wrap(async (req, res) => {
  res.json(await store.rename(req.params.id, (req.body || {}).name));
}));

// --- configuration management: history, restore, baselines ----------------
api.get("/projects/:id/history", requirePerm("read"), wrap(async (req, res) => {
  res.json({ versions: (await cm.listVersions(req.params.id)).slice().reverse(), baselines: await cm.listBaselines(req.params.id) });
}));
api.get("/projects/:id/history/:rev", requirePerm("read"), wrap(async (req, res) => {
  const v = await cm.getVersion(req.params.id, req.params.rev);
  if (!v) throw httpError(404, "No such version");
  res.json(v);
}));
api.post("/projects/:id/restore", requirePerm("write"), wrap(async (req, res) => {
  const rev = Number((req.body || {}).rev);
  const snap = await cm.getVersion(req.params.id, rev);
  if (!snap) throw httpError(404, "No such version");
  // restore forward: save the old model as a brand-new revision (never destructive)
  const saved = await store.save(req.params.id, { model: snap.model, rev: req._project.rev });
  await cm.recordVersion(saved.id, { rev: saved.rev, author: who(req), message: `Restored from r${rev}`, model: saved.model });
  res.json(saved);
}));
api.get("/projects/:id/baselines", requirePerm("read"), wrap(async (req, res) => {
  res.json(await cm.listBaselines(req.params.id));
}));
api.post("/projects/:id/baselines", requirePerm("write"), wrap(async (req, res) => {
  const { name, rev, notes } = req.body || {};
  const b = await cm.createBaseline(req.params.id, { name, rev: rev != null ? Number(rev) : req._project.rev, by: who(req), notes });
  res.status(201).json(b);
}));
api.delete("/projects/:id/baselines/:bid", requirePerm("manage"), wrap(async (req, res) => {
  await cm.removeBaseline(req.params.id, req.params.bid);
  res.status(204).end();
}));

// share: set the project's members (owner/admin only)
api.put("/projects/:id/members", requirePerm("manage"), wrap(async (req, res) => {
  const members = (((req.body || {}).members) || [])
    .filter((m) => m && typeof m.userId === "string" && (m.role === "editor" || m.role === "viewer"))
    .map((m) => ({ userId: m.userId, role: m.role }));
  res.json(await store.setMembers(req.params.id, members));
}));

api.delete("/projects/:id", requirePerm("manage"), wrap(async (req, res) => {
  await store.remove(req.params.id);
  await cm.removeProject(req.params.id);
  locks.removeProject(req.params.id);
  res.status(204).end();
}));

app.use("/api", api);

// --- admin API (global admins only) ---------------------------------------
async function audit(req, action, target) {
  const line = JSON.stringify({ ts: Date.now(), actor: req.user && req.user.username, action, target }) + "\n";
  try { await fs.appendFile(path.join(AUTH_DIR, "audit.log"), line); } catch (e) { /* non-fatal */ }
}
const admin = express.Router();
admin.use((req, res, next) => {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "Administrator access required" });
  next();
});
admin.get("/users", wrap(async (_req, res) => {
  res.json({ users: users.details(), seats: { used: users.activeCount(), max: null } });
}));
admin.post("/users", wrap(async (req, res) => {
  const { username, password, role } = req.body || {};
  const u = await users.create({ username, password, role });
  await audit(req, "user.create", u.username);
  res.status(201).json(u);
}));
admin.patch("/users/:id", wrap(async (req, res) => {
  const { role, status } = req.body || {};
  const target = users.byId(req.params.id);
  if (!target) throw httpError(404, "No such user");
  const demoting = role && role !== "admin" && target.role === "admin";
  const disabling = status === "disabled" && target.status !== "disabled";
  if ((demoting || disabling) && target.role === "admin" && target.status === "active" && users.adminCount() <= 1)
    throw httpError(400, "Can't remove the last active administrator");
  if (role) await users.setRole(target.id, role);
  if (status) { await users.setStatus(target.id, status); if (status === "disabled") await sessions.destroyUser(target.id); }
  await audit(req, "user.update", target.username + " " + JSON.stringify({ role, status }));
  res.json(users.pub(users.byId(target.id)));
}));
admin.post("/users/:id/password", wrap(async (req, res) => {
  const target = users.byId(req.params.id);
  if (!target) throw httpError(404, "No such user");
  await users.setPassword(target.id, (req.body || {}).password);
  await sessions.destroyUser(target.id); // force re-login with the new password
  await audit(req, "user.password", target.username);
  res.status(204).end();
}));
admin.delete("/users/:id", wrap(async (req, res) => {
  const target = users.byId(req.params.id);
  if (!target) throw httpError(404, "No such user");
  if (target.role === "admin" && target.status === "active" && users.adminCount() <= 1)
    throw httpError(400, "Can't remove the last active administrator");
  await users.remove(target.id);
  await sessions.destroyUser(target.id);
  await audit(req, "user.delete", target.username);
  res.status(204).end();
}));
app.use("/api/admin", admin);

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
