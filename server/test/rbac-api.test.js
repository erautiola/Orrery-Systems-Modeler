"use strict";
// Integration test for per-project authorization (auth required). Sets up test
// users directly via the exported user store, then drives the API as each.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "osm-rbac-"));
process.env.AUTH_REQUIRED = "1";
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASSWORD = "adminpass1";

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { start, users } = require("../server");

let server, base;
const cookies = {};

async function login(username, password) {
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const m = (r.headers.get("set-cookie") || "").match(/osm_sid=([^;]+)/);
  return m ? `osm_sid=${m[1]}` : null;
}
const as = (who) => ({ cookie: cookies[who] });
const jsonHdr = (who) => ({ "content-type": "application/json", cookie: cookies[who] });

before(async () => {
  server = await start(0); base = `http://localhost:${server.address().port}`;
  await users.create({ username: "alice", password: "password1" });
  await users.create({ username: "bob", password: "password1" });
  cookies.admin = await login("admin", "adminpass1");
  cookies.alice = await login("alice", "password1");
  cookies.bob = await login("bob", "password1");
});
after(() => { if (server) server.close(); });

let projectId;

test("creator becomes owner", async () => {
  const r = await fetch(base + "/api/projects", { method: "POST", headers: jsonHdr("alice"), body: JSON.stringify({ name: "Alice's" }) });
  assert.equal(r.status, 201);
  const p = await r.json();
  projectId = p.id;
  assert.ok(p.ownerId, "has an owner");
});

test("a non-member cannot read, and it isn't in their list", async () => {
  assert.equal((await fetch(`${base}/api/projects/${projectId}`, { headers: as("bob") })).status, 403);
  const bobList = await (await fetch(base + "/api/projects", { headers: as("bob") })).json();
  assert.ok(!bobList.some((p) => p.id === projectId), "not visible to bob");
  const aliceList = await (await fetch(base + "/api/projects", { headers: as("alice") })).json();
  assert.ok(aliceList.some((p) => p.id === projectId), "visible to the owner");
});

test("owner shares as editor: bob can read + write but not manage", async () => {
  let r = await fetch(`${base}/api/projects/${projectId}/members`, { method: "PUT", headers: jsonHdr("alice"), body: JSON.stringify({ members: [{ userId: users.byUsername("bob").id, role: "editor" }] }) });
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${base}/api/projects/${projectId}`, { headers: as("bob") })).status, 200);
  r = await fetch(`${base}/api/projects/${projectId}`, { method: "PUT", headers: jsonHdr("bob"), body: JSON.stringify({ model: { elements: [] } }) });
  assert.equal(r.status, 200);
  // editor cannot rename (manage) or delete
  assert.equal((await fetch(`${base}/api/projects/${projectId}`, { method: "PATCH", headers: jsonHdr("bob"), body: JSON.stringify({ name: "hijack" }) })).status, 403);
  assert.equal((await fetch(`${base}/api/projects/${projectId}`, { method: "DELETE", headers: as("bob") })).status, 403);
});

test("owner downgrades bob to viewer: read yes, write no", async () => {
  await fetch(`${base}/api/projects/${projectId}/members`, { method: "PUT", headers: jsonHdr("alice"), body: JSON.stringify({ members: [{ userId: users.byUsername("bob").id, role: "viewer" }] }) });
  assert.equal((await fetch(`${base}/api/projects/${projectId}`, { headers: as("bob") })).status, 200);
  assert.equal((await fetch(`${base}/api/projects/${projectId}`, { method: "PUT", headers: jsonHdr("bob"), body: JSON.stringify({ model: {} }) })).status, 403);
});

test("a non-owner cannot share", async () => {
  assert.equal((await fetch(`${base}/api/projects/${projectId}/members`, { method: "PUT", headers: jsonHdr("bob"), body: JSON.stringify({ members: [] }) })).status, 403);
});

test("global admin has full access to any project", async () => {
  assert.equal((await fetch(`${base}/api/projects/${projectId}`, { headers: as("admin") })).status, 200);
  assert.equal((await fetch(`${base}/api/projects/${projectId}`, { method: "PATCH", headers: jsonHdr("admin"), body: JSON.stringify({ name: "Admin renamed" }) })).status, 200);
});

test("GET /api/users lists teammates (id + username only)", async () => {
  const list = await (await fetch(base + "/api/users", { headers: as("alice") })).json();
  const names = list.map((u) => u.username).sort();
  assert.deepEqual(names, ["admin", "alice", "bob"]);
  assert.equal(list[0].passwordHash, undefined);
  assert.equal(list[0].role, undefined);
});
