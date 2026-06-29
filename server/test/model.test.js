"use strict";
// Unit tests for the model factory + catalog (public/js/model.js).
const { test } = require("node:test");
const assert = require("node:assert");
const Model = require("../../public/js/model.js");

test("newModel starts with empty collections", () => {
  const m = Model.newModel("X");
  assert.equal(m.name, "X");
  assert.deepEqual(m.elements, []);
  assert.deepEqual(m.relationships, []);
  assert.ok(Array.isArray(m.diagrams));
  assert.ok(Array.isArray(m.tables));
});

test("newElement('dbtable') has a columns array; newColumn defaults", () => {
  const e = Model.newElement("dbtable", "customer");
  assert.equal(e.type, "dbtable");
  assert.ok(Array.isArray(e.columns));
  const c = Model.newColumn("id");
  assert.equal(c.name, "id");
  assert.equal(c.pk, false);
  assert.equal(c.nullable, true);
  assert.equal(c.unique, false);
});

test("'composite' palette type normalizes to a composite State", () => {
  const e = Model.newElement("composite");
  assert.equal(e.type, "state");
  assert.equal(e.isComposite, true);
});

test("state and lifeline get their type-specific fields", () => {
  const s = Model.newElement("state");
  assert.equal(s.entry, "");
  assert.equal(s.regions, 1);
  assert.equal(Model.newElement("lifeline").represents, "");
});

test("ER diagram type and fk relationship exist in the catalog", () => {
  assert.ok(Model.DIAGRAMS.er, "er diagram type");
  assert.ok(Model.DIAGRAMS.er.elements.includes("dbtable"));
  assert.ok(Model.DIAGRAMS.er.relationships.includes("fk"));
  assert.ok(Model.RELATIONSHIPS.fk, "fk relationship");
});

test("newRelationship adds type-specific fields", () => {
  assert.equal(Model.newRelationship("transition").guard, "");
  assert.equal(Model.newRelationship("fk").fkColumn, "");
  assert.equal(Model.newRelationship("msgSync").y, 0);
  assert.equal(Model.newRelationship("controlflow").guard, "");
});

test("Activity diagram type and its elements/relationships exist", () => {
  assert.ok(Model.DIAGRAMS.activity, "activity diagram type");
  assert.ok(Model.DIAGRAMS.activity.elements.includes("action"));
  assert.ok(Model.DIAGRAMS.activity.elements.includes("partition"));
  assert.ok(Model.DIAGRAMS.activity.relationships.includes("controlflow"));
  assert.ok(Model.RELATIONSHIPS.controlflow && Model.RELATIONSHIPS.objectflow);
  assert.ok(Model.ELEMENTS.action && Model.ELEMENTS.partition && Model.ELEMENTS.flowfinal);
});

test("label helpers format correctly", () => {
  assert.equal(Model.transitionLabel({ trigger: "t", guard: "g", effect: "e" }), "t [g] / e");
  assert.equal(Model.messageLabel({ type: "msgSync", name: "op", args: "a", returnValue: "r" }), "r = op(a)");
});

test("removeElement also drops its relationships and diagram nodes", () => {
  const m = Model.newModel();
  const a = Model.newElement("class", "A"); const b = Model.newElement("class", "B");
  m.elements.push(a, b);
  m.relationships.push(Model.newRelationship("association", a.id, b.id));
  const d = Model.newDiagram("class"); d.nodes.push({ elementId: a.id, x: 0, y: 0 }); m.diagrams.push(d);
  Model.removeElement(m, a.id);
  assert.equal(m.elements.length, 1);
  assert.equal(m.relationships.length, 0);
  assert.equal(d.nodes.length, 0);
});
