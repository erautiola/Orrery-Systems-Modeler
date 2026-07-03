"use strict";
// Unit tests for the file-based user store.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { UserStore } = require("../users");

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-users-"));
  const s = new UserStore(dir);
  await s.init();
  return s;
}

test("create returns a safe public shape (no hash)", async () => {
  const s = await tmpStore();
  const u = await s.create({ username: "alice", password: "password1" });
  assert.equal(u.username, "alice");
  assert.equal(u.role, "user");
  assert.equal(u.status, "active");
  assert.equal(u.passwordHash, undefined);
});

test("duplicate username -> 409, short password -> 400, bad username -> 400", async () => {
  const s = await tmpStore();
  await s.create({ username: "bob", password: "password1" });
  await assert.rejects(() => s.create({ username: "BOB", password: "password1" }), (e) => e.status === 409);
  await assert.rejects(() => s.create({ username: "carol", password: "short" }), (e) => e.status === 400);
  await assert.rejects(() => s.create({ username: "no spaces!", password: "password1" }), (e) => e.status === 400);
});

test("login succeeds with right password, fails otherwise", async () => {
  const s = await tmpStore();
  await s.create({ username: "dave", password: "correct-horse" });
  const u = await s.login("dave", "correct-horse");
  assert.equal(u.username, "dave");
  await assert.rejects(() => s.login("dave", "nope"), (e) => e.status === 401);
  await assert.rejects(() => s.login("ghost", "whatever"), (e) => e.status === 401);
});

test("account locks after 5 failed attempts", async () => {
  const s = await tmpStore();
  await s.create({ username: "eve", password: "letmein-please" });
  for (let i = 0; i < 5; i++) await assert.rejects(() => s.login("eve", "bad"), (e) => e.status === 401);
  // even the correct password is refused while locked
  await assert.rejects(() => s.login("eve", "letmein-please"), (e) => e.status === 429);
});

test("disabled users cannot log in", async () => {
  const s = await tmpStore();
  const u = await s.create({ username: "frank", password: "password1" });
  await s.setStatus(u.id, "disabled");
  await assert.rejects(() => s.login("frank", "password1"), (e) => e.status === 401);
});

test("bootstraps the first admin from ADMIN_USER/ADMIN_PASSWORD", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-boot-"));
  const prevU = process.env.ADMIN_USER, prevP = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_USER = "root"; process.env.ADMIN_PASSWORD = "rootpass1";
  try {
    const s = new UserStore(dir); await s.init();
    const admin = s.byUsername("root");
    assert.ok(admin);
    assert.equal(admin.role, "admin");
    assert.ok(await s.login("root", "rootpass1"));
  } finally {
    if (prevU === undefined) delete process.env.ADMIN_USER; else process.env.ADMIN_USER = prevU;
    if (prevP === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = prevP;
  }
});

test("persists across reloads", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-persist-"));
  const s1 = new UserStore(dir); await s1.init();
  await s1.create({ username: "gina", password: "password1" });
  const s2 = new UserStore(dir); await s2.init();
  assert.ok(s2.byUsername("gina"));
  assert.equal(s2.activeCount(), 1);
});
