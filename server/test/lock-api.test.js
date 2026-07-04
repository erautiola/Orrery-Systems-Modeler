"use strict";
// Integration test for edit locks with two users (auth required).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "osm-lockapi-"));
process.env.AUTH_REQUIRED = "1";
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASSWORD = "adminpass1";

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { start } = require("../server");

let server, base, adminSid, aliceSid, pid;
const sidFrom = (r) => { const m = (r.headers.get("set-cookie") || "").match(/osm_sid=([^;]+)/); return m ? m[1] : null; };
const J = (body, sid, method) => ({ method: method || "POST", headers: { "content-type": "application/json", ...(sid ? { cookie: "osm_sid=" + sid } : {}) }, body: JSON.stringify(body) });
const G = (sid) => ({ headers: { cookie: "osm_sid=" + sid } });

before(async () => {
  server = await start(0); base = `http://localhost:${server.address().port}`;
  adminSid = sidFrom(await fetch(base + "/api/auth/login", J({ username: "admin", password: "adminpass1" })));
  const alice = await (await fetch(base + "/api/admin/users", J({ username: "alice", password: "alicepass1", role: "user" }, adminSid))).json();
  pid = (await (await fetch(base + "/api/projects", J({ name: "Locked" }, adminSid))).json()).id; // owned by admin
  await fetch(`${base}/api/projects/${pid}/members`, J({ members: [{ userId: alice.id, role: "editor" }] }, adminSid, "PUT"));
  aliceSid = sidFrom(await fetch(base + "/api/auth/login", J({ username: "alice", password: "alicepass1" })));
});
after(() => { if (server) server.close(); });

test("alice checks out the project; admin is refused the lock", async () => {
  const a = await (await fetch(`${base}/api/projects/${pid}/lock`, J({}, aliceSid))).json();
  assert.equal(a.ok, true);
  assert.equal(a.lock.username, "alice");
  const b = await (await fetch(`${base}/api/projects/${pid}/lock`, J({}, adminSid))).json();
  assert.equal(b.ok, false);
  assert.equal(b.lock.username, "alice");
});

test("a non-holder's save is 423; the holder's save succeeds", async () => {
  const bad = await fetch(`${base}/api/projects/${pid}`, J({ model: { elements: [] }, rev: 1 }, adminSid, "PUT"));
  assert.equal(bad.status, 423);
  const ok = await fetch(`${base}/api/projects/${pid}`, J({ model: { elements: [{ id: "x" }] }, rev: 1 }, aliceSid, "PUT"));
  assert.equal(ok.status, 200);
});

test("owner/admin can force a take-over; the previous holder loses renew", async () => {
  const forced = await (await fetch(`${base}/api/projects/${pid}/lock`, J({ force: true }, adminSid))).json();
  assert.equal(forced.ok, true);
  assert.equal(forced.lock.username, "admin");
  const renew = await (await fetch(`${base}/api/projects/${pid}/lock/renew`, J({}, aliceSid))).json();
  assert.equal(renew.ok, false);
});

test("release frees the lock", async () => {
  assert.equal((await fetch(`${base}/api/projects/${pid}/lock`, { method: "DELETE", headers: { cookie: "osm_sid=" + adminSid } })).status, 204);
  const now = await (await fetch(`${base}/api/projects/${pid}/lock`, G(adminSid))).json();
  assert.equal(now.lock, null);
});
