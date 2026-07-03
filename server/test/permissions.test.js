"use strict";
// Unit tests for the pure authorization policy.
const { test } = require("node:test");
const assert = require("node:assert");
const { can, projectRole } = require("../../public/js/permissions.js");

const admin = { id: "a", role: "admin" };
const owner = { id: "o", role: "user" };
const editor = { id: "e", role: "user" };
const viewer = { id: "v", role: "user" };
const stranger = { id: "s", role: "user" };
const proj = { ownerId: "o", members: [{ userId: "e", role: "editor" }, { userId: "v", role: "viewer" }] };

test("projectRole resolves owner / editor / viewer / none", () => {
  assert.equal(projectRole(owner, proj), "owner");
  assert.equal(projectRole(editor, proj), "editor");
  assert.equal(projectRole(viewer, proj), "viewer");
  assert.equal(projectRole(stranger, proj), null);
});

test("global admin can do everything", () => {
  for (const act of ["read", "write", "manage"]) assert.ok(can(admin, act, proj));
});

test("owner: read/write/manage", () => {
  assert.ok(can(owner, "read", proj));
  assert.ok(can(owner, "write", proj));
  assert.ok(can(owner, "manage", proj));
});

test("editor: read/write but not manage", () => {
  assert.ok(can(editor, "read", proj));
  assert.ok(can(editor, "write", proj));
  assert.ok(!can(editor, "manage", proj));
});

test("viewer: read only", () => {
  assert.ok(can(viewer, "read", proj));
  assert.ok(!can(viewer, "write", proj));
  assert.ok(!can(viewer, "manage", proj));
});

test("a stranger has no access to an owned project", () => {
  assert.ok(!can(stranger, "read", proj));
  assert.ok(!can(stranger, "write", proj));
  assert.ok(!can(stranger, "manage", proj));
});

test("no user -> denied", () => {
  assert.ok(!can(null, "read", proj));
});

test("unowned/legacy project is shared: any user reads+writes, only admin manages", () => {
  const legacy = { ownerId: null, members: [] };
  assert.ok(can(stranger, "read", legacy));
  assert.ok(can(stranger, "write", legacy));
  assert.ok(!can(stranger, "manage", legacy));
  assert.ok(can(admin, "manage", legacy));
});
