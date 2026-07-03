"use strict";
// Integration test with authentication REQUIRED. Env must be set before the
// server module loads (it reads AUTH_REQUIRED / DATA_DIR / ADMIN_* at load).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "osm-authapi-"));
process.env.AUTH_REQUIRED = "1";
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASSWORD = "adminpass1";

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { start } = require("../server");

let server, base;
before(async () => { server = await start(0); base = `http://localhost:${server.address().port}`; });
after(() => { if (server) server.close(); });

const sidFrom = (res) => { const m = (res.headers.get("set-cookie") || "").match(/osm_sid=([^;]+)/); return m ? m[1] : null; };

test("health is reachable without auth", async () => {
  assert.equal((await fetch(base + "/api/health")).status, 200);
});

test("/api/auth/me reports auth required and no user", async () => {
  const info = await (await fetch(base + "/api/auth/me")).json();
  assert.equal(info.authRequired, true);
  assert.equal(info.user, null);
});

test("guarded API is 401 without a session", async () => {
  assert.equal((await fetch(base + "/api/projects")).status, 401);
});

test("login -> cookie -> access -> logout -> 401 again", async () => {
  // wrong password first
  let r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "nope" }) });
  assert.equal(r.status, 401);

  // correct login
  r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "adminpass1" }) });
  assert.equal(r.status, 200);
  const sid = sidFrom(r);
  assert.ok(sid, "a session cookie was set");
  assert.equal((await r.json()).user.username, "admin");

  // authenticated request works
  const cookie = { cookie: `osm_sid=${sid}` };
  r = await fetch(base + "/api/projects", { headers: cookie });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(await r.json()));

  // me now reports the user
  const me = await (await fetch(base + "/api/auth/me", { headers: cookie })).json();
  assert.equal(me.user.username, "admin");
  assert.equal(me.user.role, "admin");

  // logout, then the same cookie is rejected
  r = await fetch(base + "/api/auth/logout", { method: "POST", headers: cookie });
  assert.equal(r.status, 204);
  r = await fetch(base + "/api/projects", { headers: cookie });
  assert.equal(r.status, 401);
});
