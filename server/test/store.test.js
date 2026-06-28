"use strict";
// Unit tests for the file-based project store (no HTTP). Uses the Node built-in
// test runner (`node --test`) — no external test dependencies.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../store");

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-store-"));
  const s = new Store(dir);
  await s.init();
  return s;
}

test("create assigns an id and rev 1", async () => {
  const s = await tmpStore();
  const p = await s.create("Demo");
  assert.ok(p.id, "has id");
  assert.equal(p.rev, 1);
  assert.equal(p.name, "Demo");
  assert.ok(p.model && Array.isArray(p.model.elements));
});

test("save bumps rev and persists the model", async () => {
  const s = await tmpStore();
  const p = await s.create("Demo");
  const saved = await s.save(p.id, { model: { name: "Demo", elements: [{ id: "e1" }] }, rev: 1 });
  assert.equal(saved.rev, 2);
  const got = await s.get(p.id);
  assert.equal(got.rev, 2);
  assert.equal(got.model.elements.length, 1);
});

test("save with a stale rev is rejected with 409", async () => {
  const s = await tmpStore();
  const p = await s.create("Demo");
  await s.save(p.id, { rev: 1 }); // -> rev 2
  await assert.rejects(() => s.save(p.id, { rev: 1 }), (e) => e.status === 409);
});

test("save without a rev skips the concurrency check", async () => {
  const s = await tmpStore();
  const p = await s.create("Demo");
  const saved = await s.save(p.id, { name: "Renamed" });
  assert.equal(saved.rev, 2);
  assert.equal(saved.name, "Renamed");
});

test("list returns summaries; remove deletes", async () => {
  const s = await tmpStore();
  const a = await s.create("A");
  await s.create("B");
  assert.equal((await s.list()).length, 2);
  await s.remove(a.id);
  assert.equal((await s.list()).length, 1);
});

test("get on a missing project rejects with 404", async () => {
  const s = await tmpStore();
  await assert.rejects(() => s.get("does-not-exist"), (e) => e.status === 404);
});

test("ids that look like path traversal are rejected", async () => {
  const s = await tmpStore();
  await assert.rejects(() => s.get("../../etc/passwd"));
});
