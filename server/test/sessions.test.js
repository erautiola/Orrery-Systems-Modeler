"use strict";
// Unit tests for the file-based session store.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { SessionStore } = require("../sessions");

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-sess-"));
  const s = new SessionStore(dir);
  await s.init();
  return s;
}

test("create -> get returns the user; ids are long & unique", async () => {
  const s = await tmpStore();
  const a = await s.create("user-1");
  const b = await s.create("user-1");
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
  assert.equal(s.get(a).userId, "user-1");
});

test("get on unknown/expired session returns null", async () => {
  const s = await tmpStore();
  assert.equal(s.get("nope"), null);
  const id = await s.create("u");
  s.sessions[id].expiresAt = Date.now() - 1; // force-expire
  assert.equal(s.get(id), null);
});

test("destroy removes a session", async () => {
  const s = await tmpStore();
  const id = await s.create("u");
  await s.destroy(id);
  assert.equal(s.get(id), null);
});

test("destroyUser removes every session for a user", async () => {
  const s = await tmpStore();
  const a = await s.create("u1"); const b = await s.create("u1"); const c = await s.create("u2");
  await s.destroyUser("u1");
  assert.equal(s.get(a), null);
  assert.equal(s.get(b), null);
  assert.equal(s.get(c).userId, "u2");
});

test("rejects non-token ids and never pollutes Object.prototype", async () => {
  const s = await tmpStore();
  assert.equal(s.get("__proto__"), null);
  assert.equal(s.get("constructor"), null);
  assert.equal(s.get("../../etc"), null);
  await s.destroy("__proto__"); // must be a safe no-op
  assert.equal(({}).userId, undefined, "prototype was not polluted");
});

test("persists across reloads", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-sess2-"));
  const s1 = new SessionStore(dir); await s1.init();
  const id = await s1.create("u");
  const s2 = new SessionStore(dir); await s2.init();
  assert.equal(s2.get(id).userId, "u");
});
