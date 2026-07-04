"use strict";
// Integration tests for the CM endpoints (history / restore / baselines).
// Runs in open mode (no auth) to keep the test focused on CM behaviour.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "osm-cmapi-"));
delete process.env.AUTH_REQUIRED;

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { start } = require("../server");

let server, base, pid;
const J = (body, method) => ({ method: method || "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

before(async () => {
  server = await start(0); base = `http://localhost:${server.address().port}`;
  pid = (await (await fetch(base + "/api/projects", J({ name: "CM" }))).json()).id;
});
after(() => { if (server) server.close(); });

test("creating a project records an initial version", async () => {
  const h = await (await fetch(`${base}/api/projects/${pid}/history`)).json();
  assert.equal(h.versions.length, 1);
  assert.equal(h.versions[0].rev, 1);
  assert.equal(h.versions[0].message, "Created");
});

test("saving records a new version; snapshot holds that model", async () => {
  await fetch(`${base}/api/projects/${pid}`, J({ model: { elements: [{ id: "x" }] }, rev: 1 }, "PUT"));
  const h = await (await fetch(`${base}/api/projects/${pid}/history`)).json();
  assert.equal(h.versions.length, 2);
  assert.equal(h.versions[0].rev, 2); // newest first
  const snap = await (await fetch(`${base}/api/projects/${pid}/history/2`)).json();
  assert.equal(snap.model.elements.length, 1);
});

test("restore forward: re-saves an old model as a new revision", async () => {
  // save again so current model differs from rev 1
  await fetch(`${base}/api/projects/${pid}`, J({ model: { elements: [{ id: "a" }, { id: "b" }] }, rev: 2 }, "PUT"));
  // restore rev 1 (which was empty)
  const restored = await (await fetch(`${base}/api/projects/${pid}/restore`, J({ rev: 1 }))).json();
  assert.equal(restored.rev, 4); // rev 3 was the save above; restore -> rev 4
  assert.equal((restored.model.elements || []).length, 0, "model matches the restored rev 1");
  const h = await (await fetch(`${base}/api/projects/${pid}/history`)).json();
  assert.match(h.versions[0].message, /Restored from r1/);
});

test("baselines: create, list, delete", async () => {
  const b = await (await fetch(`${base}/api/projects/${pid}/baselines`, J({ name: "PDR", rev: 2 }))).json();
  assert.equal(b.name, "PDR");
  let list = await (await fetch(`${base}/api/projects/${pid}/baselines`)).json();
  assert.ok(list.some((x) => x.name === "PDR"));
  assert.equal((await fetch(`${base}/api/projects/${pid}/baselines/${b.id}`, { method: "DELETE" })).status, 204);
  list = await (await fetch(`${base}/api/projects/${pid}/baselines`)).json();
  assert.ok(!list.some((x) => x.id === b.id));
});

test("deleting a project removes its history", async () => {
  const p2 = (await (await fetch(base + "/api/projects", J({ name: "Temp" }))).json()).id;
  await fetch(`${base}/api/projects/${p2}`, { method: "DELETE" });
  const h = await (await fetch(`${base}/api/projects/${p2}/history`));
  assert.equal(h.status, 404); // project gone -> requirePerm 404
});
