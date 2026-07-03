"use strict";
// Unit tests for Model.canReparent — the Model Explorer drag-and-drop guard.
const { test } = require("node:test");
const assert = require("node:assert");
const Model = require("../../public/js/model.js");

function model() {
  const m = Model.newModel();
  const pkg = Model.newElement("package"); pkg.name = "Pkg";
  const pkg2 = Model.newElement("package"); pkg2.name = "Pkg2";
  const blk = Model.newElement("block"); blk.name = "Blk";
  const cls = Model.newElement("class"); cls.name = "Cls";
  const note = Model.newElement("note"); note.name = "N";
  const port = Model.newElement("port"); port.name = "p";
  m.elements.push(pkg, pkg2, blk, cls, note, port);
  return { m, pkg, pkg2, blk, cls, note, port };
}

test("can move an element into a package or a block", () => {
  const { m, pkg, blk, cls } = model();
  assert.ok(Model.canReparent(m, cls.id, pkg.id));
  assert.ok(Model.canReparent(m, cls.id, blk.id));
});

test("cannot drop onto a non-owning target (note, port)", () => {
  const { m, cls, note, port } = model();
  assert.ok(!Model.canReparent(m, cls.id, note.id));
  assert.ok(!Model.canReparent(m, cls.id, port.id));
});

test("cannot drop onto itself, or a no-op re-parent", () => {
  const { m, pkg, cls } = model();
  assert.ok(!Model.canReparent(m, cls.id, cls.id));
  cls.ownerId = pkg.id;
  assert.ok(!Model.canReparent(m, cls.id, pkg.id)); // already owned by pkg
});

test("rejects cycles: can't move a package into its own descendant", () => {
  const { m, pkg, pkg2, blk } = model();
  pkg2.ownerId = pkg.id;   // pkg > pkg2
  blk.ownerId = pkg2.id;   // pkg > pkg2 > blk
  assert.ok(!Model.canReparent(m, pkg.id, pkg2.id)); // pkg into its child
  assert.ok(!Model.canReparent(m, pkg.id, blk.id));  // pkg into its grandchild
  assert.ok(Model.canReparent(m, blk.id, pkg.id));   // but blk up to pkg is fine
});

test("null target un-parents to the root (unless already a root)", () => {
  const { m, pkg, cls } = model();
  assert.ok(!Model.canReparent(m, cls.id, null)); // already a root -> no-op
  cls.ownerId = pkg.id;
  assert.ok(Model.canReparent(m, cls.id, null));  // nested -> can move to root
});
