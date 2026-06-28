"use strict";
// Integration tests: boot the real Express app on an ephemeral port and drive
// the REST API over HTTP with the built-in fetch. DATA_DIR must be set before
// requiring the server (it is read at module load).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "osm-api-"));

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { start } = require("../server");

let server, base;

before(async () => {
  server = await start(0); // port 0 -> ephemeral
  base = `http://localhost:${server.address().port}`;
});
after(() => { if (server) server.close(); });

const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("GET /api/health returns ok", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test("project lifecycle: create -> get -> save -> conflict -> delete", async () => {
  // create
  let r = await fetch(base + "/api/projects", json({ name: "IT" }));
  assert.equal(r.status, 201);
  const p = await r.json();
  assert.equal(p.rev, 1);

  // get
  r = await fetch(`${base}/api/projects/${p.id}`);
  assert.equal(r.status, 200);

  // save with correct rev -> 200, rev bumps
  r = await fetch(`${base}/api/projects/${p.id}`, { ...json({ name: "IT", model: { elements: [] }, rev: 1 }), method: "PUT" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).rev, 2);

  // save with stale rev -> 409
  r = await fetch(`${base}/api/projects/${p.id}`, { ...json({ rev: 1 }), method: "PUT" });
  assert.equal(r.status, 409);

  // delete -> 204, then 404
  r = await fetch(`${base}/api/projects/${p.id}`, { method: "DELETE" });
  assert.equal(r.status, 204);
  r = await fetch(`${base}/api/projects/${p.id}`);
  assert.equal(r.status, 404);
});

test("GET /api/projects returns an array", async () => {
  const r = await fetch(base + "/api/projects");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(await r.json()));
});

test("SPA fallback serves index.html for non-API routes (Express 5 RegExp route)", async () => {
  const r = await fetch(base + "/some/client/route");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Orrery Systems Modeler/);
});

test("unknown API route returns JSON 404-style error, not HTML", async () => {
  const r = await fetch(base + "/api/projects/nonexistent");
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("content-type")?.includes("application/json"), true);
});
