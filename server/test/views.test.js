"use strict";
// Unit tests for diagram/table association helpers (Model Explorer, issue #42).
const { test } = require("node:test");
const assert = require("node:assert");
const Model = require("../../public/js/model.js");

function model() {
  const m = Model.newModel();
  m.diagrams = []; m.tables = [];
  const pkg = Model.newElement("package"); pkg.name = "Sys";
  const blk = Model.newElement("block"); blk.name = "Car";
  m.elements.push(pkg, blk);
  return { m, pkg, blk };
}

test("a diagram with ownerId is associated with that element", () => {
  const { m, pkg } = model();
  const d = Model.newDiagram("class", "Overview"); d.ownerId = pkg.id;
  m.diagrams.push(d);
  const views = Model.viewsForElement(m, pkg.id);
  assert.equal(views.length, 1);
  assert.equal(views[0].kind, "diagram");
  assert.equal(views[0].id, d.id);
});

test("an IBD is associated with its block via blockId (no explicit owner)", () => {
  const { m, blk } = model();
  const d = Model.newDiagram("ibd", "Car IBD"); d.blockId = blk.id;
  m.diagrams.push(d);
  assert.equal(Model.diagramOwner(d), blk.id);
  assert.equal(Model.viewsForElement(m, blk.id).length, 1);
});

test("an explicit ownerId overrides an IBD's blockId", () => {
  const { m, pkg, blk } = model();
  const d = Model.newDiagram("ibd", "Car IBD"); d.blockId = blk.id; d.ownerId = pkg.id;
  m.diagrams.push(d);
  assert.equal(Model.diagramOwner(d), pkg.id);
  assert.equal(Model.viewsForElement(m, pkg.id).length, 1);
  assert.equal(Model.viewsForElement(m, blk.id).length, 0);
});

test("tables associate via ownerId", () => {
  const { m, pkg } = model();
  const t = Model.newTable("element", "Elements"); t.ownerId = pkg.id;
  m.tables.push(t);
  const views = Model.viewsForElement(m, pkg.id);
  assert.equal(views.length, 1);
  assert.equal(views[0].kind, "table");
});

test("unassociatedViews: unfiled views and orphans (owner element gone)", () => {
  const { m, pkg } = model();
  const unfiled = Model.newDiagram("class", "Loose");            // no owner
  const filed = Model.newDiagram("class", "Filed"); filed.ownerId = pkg.id;
  const orphan = Model.newDiagram("class", "Orphan"); orphan.ownerId = "does-not-exist";
  m.diagrams.push(unfiled, filed, orphan);
  const roots = Model.unassociatedViews(m).map((v) => v.name).sort();
  assert.deepEqual(roots, ["Loose", "Orphan"]); // filed one is nested, not at root
});
