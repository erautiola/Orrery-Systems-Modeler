"use strict";
// Unit tests for the model validation rules (public/js/validate.js).
const { test } = require("node:test");
const assert = require("node:assert");
const Validate = require("../../public/js/validate.js");

const has = (issues, sev, re) => issues.some((i) => i.severity === sev && re.test(i.message));

test("clean model reports no errors/warnings", () => {
  const model = {
    elements: [
      { id: "a", type: "class", name: "A" },
      { id: "b", type: "class", name: "B", isAbstract: false },
    ],
    relationships: [{ id: "r", type: "association", sourceId: "a", targetId: "b" }],
    diagrams: [],
  };
  const s = Validate.summary(Validate.run(model));
  assert.equal(s.error, 0);
  assert.equal(s.warning, 0);
});

test("blank element name is an error", () => {
  const issues = Validate.run({ elements: [{ id: "a", type: "class", name: "" }], relationships: [], diagrams: [] });
  assert.ok(has(issues, "error", /has no name/));
});

test("dangling relationship endpoint is an error", () => {
  const issues = Validate.run({
    elements: [{ id: "a", type: "class", name: "A" }],
    relationships: [{ id: "r", type: "association", sourceId: "a", targetId: "ghost" }],
    diagrams: [],
  });
  assert.ok(has(issues, "error", /missing endpoint/));
});

test("generalization cycle is detected", () => {
  const issues = Validate.run({
    elements: [{ id: "a", type: "class", name: "A" }, { id: "b", type: "class", name: "B" }],
    relationships: [
      { id: "1", type: "generalization", sourceId: "a", targetId: "b" },
      { id: "2", type: "generalization", sourceId: "b", targetId: "a" },
    ],
    diagrams: [],
  });
  assert.ok(has(issues, "error", /Generalization cycle/));
});

test("enumeration without literals is a warning", () => {
  const issues = Validate.run({ elements: [{ id: "e", type: "enumeration", name: "Color", literals: [] }], relationships: [], diagrams: [] });
  assert.ok(has(issues, "warning", /no literals/));
});

test("dbtable without PK warns; column without type is info", () => {
  const issues = Validate.run({
    elements: [{ id: "t", type: "dbtable", name: "users", columns: [{ name: "email" }] }],
    relationships: [], diagrams: [],
  });
  assert.ok(has(issues, "warning", /no primary key/));
  assert.ok(has(issues, "info", /has no type/));
});

test("requirement missing id/text warns", () => {
  const issues = Validate.run({ elements: [{ id: "q", type: "requirement", name: "R", tags: {} }], relationships: [], diagrams: [] });
  assert.ok(has(issues, "warning", /has no id/));
  assert.ok(has(issues, "warning", /has no text/));
});

test("diagram referencing a deleted element is an error", () => {
  const issues = Validate.run({
    elements: [{ id: "a", type: "class", name: "A" }],
    relationships: [],
    diagrams: [{ id: "d", name: "Main", nodes: [{ elementId: "gone" }] }],
  });
  assert.ok(has(issues, "error", /references a deleted element/));
});

test("duplicate names of the same type warn", () => {
  const issues = Validate.run({
    elements: [{ id: "a", type: "class", name: "Dup" }, { id: "b", type: "class", name: "Dup" }],
    relationships: [], diagrams: [],
  });
  assert.ok(has(issues, "warning", /Duplicate/));
});
