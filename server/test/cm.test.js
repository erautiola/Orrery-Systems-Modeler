"use strict";
// Unit tests for the file-based CM store (version history + baselines).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CmStore } = require("../cm");

async function tmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-cm-"));
  return new CmStore(dir);
}
const model = (n) => ({ name: "M", elements: Array.from({ length: n }, (_, i) => ({ id: "e" + i })) });

test("recordVersion snapshots the model and appends history", async () => {
  const s = await tmp();
  await s.recordVersion("p1", { rev: 1, author: "alice", message: "Created", model: model(1) });
  await s.recordVersion("p1", { rev: 2, author: "bob", message: "", model: model(3) });
  const hist = await s.listVersions("p1");
  assert.equal(hist.length, 2);
  assert.deepEqual(hist.map((h) => h.rev), [1, 2]);
  assert.equal(hist[0].author, "alice");
  const v2 = await s.getVersion("p1", 2);
  assert.equal(v2.model.elements.length, 3);
  assert.equal(await s.getVersion("p1", 99), null);
});

test("baselines: create, list, remove; baseline of a missing rev is rejected", async () => {
  const s = await tmp();
  await s.recordVersion("p1", { rev: 1, author: "a", model: model(1) });
  const b = await s.createBaseline("p1", { name: "PDR", rev: 1, by: "a", notes: "review" });
  assert.ok(b.id);
  assert.equal(b.name, "PDR");
  assert.deepEqual((await s.listBaselines("p1")).map((x) => x.name), ["PDR"]);
  await assert.rejects(() => s.createBaseline("p1", { name: "x", rev: 42 }), (e) => e.status === 400);
  await s.removeBaseline("p1", b.id);
  assert.equal((await s.listBaselines("p1")).length, 0);
});

test("prune keeps the last 100 versions plus any baselined revision", async () => {
  const s = await tmp();
  await s.recordVersion("p1", { rev: 1, author: "a", model: model(1) });
  await s.createBaseline("p1", { name: "first", rev: 1, by: "a" });
  for (let r = 2; r <= 105; r++) await s.recordVersion("p1", { rev: r, author: "a", model: model(1) });
  const hist = await s.listVersions("p1");
  // last 100 (revs 6..105) + baselined rev 1 = 101
  assert.equal(hist.length, 101);
  assert.ok(await s.getVersion("p1", 1), "baselined rev survives pruning");
  assert.equal(await s.getVersion("p1", 3), null, "old non-baselined rev pruned");
  assert.ok(await s.getVersion("p1", 105), "newest kept");
});

test("removeProject deletes all history for a project", async () => {
  const s = await tmp();
  await s.recordVersion("p1", { rev: 1, author: "a", model: model(1) });
  await s.removeProject("p1");
  assert.deepEqual(await s.listVersions("p1"), []);
  assert.equal(await s.getVersion("p1", 1), null);
});

test("rejects path-traversal project ids", async () => {
  const s = await tmp();
  await assert.rejects(() => s.listVersions("../evil"), (e) => e.status === 400);
});
