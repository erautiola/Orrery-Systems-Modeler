"use strict";
// Integration tests for the admin user-management API.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "osm-admin-"));
process.env.AUTH_REQUIRED = "1";
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASSWORD = "adminpass1";

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { start } = require("../server");

let server, base;
async function login(username, password) {
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const m = (r.headers.get("set-cookie") || "").match(/osm_sid=([^;]+)/);
  return { status: r.status, cookie: m ? `osm_sid=${m[1]}` : null };
}
const H = (cookie, body) => ({ method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json", cookie } : { cookie }, body: body ? JSON.stringify(body) : undefined });

let adminCookie;
before(async () => {
  server = await start(0); base = `http://localhost:${server.address().port}`;
  adminCookie = (await login("admin", "adminpass1")).cookie;
});
after(() => { if (server) server.close(); });

test("non-admins are refused (403)", async () => {
  // admin creates a plain user, who then can't reach the admin API
  await fetch(base + "/api/admin/users", { ...H(adminCookie, { username: "alice", password: "password1", role: "user" }) });
  const alice = await login("alice", "password1");
  const r = await fetch(base + "/api/admin/users", { headers: { cookie: alice.cookie } });
  assert.equal(r.status, 403);
});

test("admin creates, lists (with seat usage), and the list omits hashes", async () => {
  const r = await fetch(base + "/api/admin/users", { ...H(adminCookie, { username: "carol", password: "password1", role: "user" }) });
  assert.equal(r.status, 201);
  const data = await (await fetch(base + "/api/admin/users", { headers: { cookie: adminCookie } })).json();
  assert.ok(data.users.some((u) => u.username === "carol"));
  assert.equal(data.seats.used, data.users.filter((u) => u.status === "active").length);
  assert.equal(data.users[0].passwordHash, undefined);
});

test("disabling a user kills their active sessions", async () => {
  const carol = await login("carol", "password1");
  assert.equal((await fetch(base + "/api/projects", { headers: { cookie: carol.cookie } })).status, 200);
  const carolId = (await (await fetch(base + "/api/admin/users", { headers: { cookie: adminCookie } })).json()).users.find((u) => u.username === "carol").id;
  await fetch(`${base}/api/admin/users/${carolId}`, { method: "PATCH", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ status: "disabled" }) });
  assert.equal((await fetch(base + "/api/projects", { headers: { cookie: carol.cookie } })).status, 401);
  await fetch(`${base}/api/admin/users/${carolId}`, { method: "PATCH", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ status: "active" }) });
});

test("the last active admin can't be demoted, disabled, or deleted", async () => {
  const adminId = (await (await fetch(base + "/api/admin/users", { headers: { cookie: adminCookie } })).json()).users.find((u) => u.username === "admin").id;
  const patch = (b) => fetch(`${base}/api/admin/users/${adminId}`, { method: "PATCH", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify(b) });
  assert.equal((await patch({ role: "user" })).status, 400);
  assert.equal((await patch({ status: "disabled" })).status, 400);
  assert.equal((await fetch(`${base}/api/admin/users/${adminId}`, { method: "DELETE", headers: { cookie: adminCookie } })).status, 400);
});

test("password reset forces re-login and works with the new password", async () => {
  const carolId = (await (await fetch(base + "/api/admin/users", { headers: { cookie: adminCookie } })).json()).users.find((u) => u.username === "carol").id;
  const carol = await login("carol", "password1");
  await fetch(`${base}/api/admin/users/${carolId}/password`, { method: "POST", headers: { "content-type": "application/json", cookie: adminCookie }, body: JSON.stringify({ password: "newpassword2" }) });
  // old session invalidated
  assert.equal((await fetch(base + "/api/projects", { headers: { cookie: carol.cookie } })).status, 401);
  // old password rejected, new one accepted
  assert.equal((await login("carol", "password1")).status, 401);
  assert.equal((await login("carol", "newpassword2")).status, 200);
});

test("admin can delete a user", async () => {
  const carolId = (await (await fetch(base + "/api/admin/users", { headers: { cookie: adminCookie } })).json()).users.find((u) => u.username === "carol").id;
  assert.equal((await fetch(`${base}/api/admin/users/${carolId}`, { method: "DELETE", headers: { cookie: adminCookie } })).status, 204);
  const data = await (await fetch(base + "/api/admin/users", { headers: { cookie: adminCookie } })).json();
  assert.ok(!data.users.some((u) => u.username === "carol"));
});
