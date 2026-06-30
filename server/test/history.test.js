"use strict";
// Unit tests for the undo/redo history stack (public/js/history.js).
const { test } = require("node:test");
const assert = require("node:assert");
const { createHistory, COALESCE_MS } = require("../../public/js/history.js");

test("fresh history after reset has no undo/redo", () => {
  const h = createHistory();
  h.reset({ v: 0 });
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
});

test("push then undo/redo navigates snapshots", () => {
  const h = createHistory();
  h.reset({ v: 0 });
  h.push({ v: 1 }, null, 1000);
  h.push({ v: 2 }, null, 2000);
  assert.equal(h.canUndo(), true);
  assert.deepEqual(h.undo(), { v: 1 });
  assert.deepEqual(h.undo(), { v: 0 });
  assert.equal(h.canUndo(), false);
  assert.deepEqual(h.redo(), { v: 1 });
  assert.deepEqual(h.redo(), { v: 2 });
  assert.equal(h.canRedo(), false);
});

test("a new push after undo truncates the redo future", () => {
  const h = createHistory();
  h.reset({ v: 0 });
  h.push({ v: 1 }, null, 1000);
  h.push({ v: 2 }, null, 2000);
  h.undo(); // back to v:1
  h.push({ v: 9 }, null, 3000);
  assert.equal(h.canRedo(), false);
  assert.deepEqual(h.undo(), { v: 1 });
  assert.deepEqual(h.redo(), { v: 9 });
});

test("same key within window coalesces (no new step)", () => {
  const h = createHistory();
  h.reset({ t: "" });
  h.push({ t: "a" }, "prop", 1000);
  h.push({ t: "ab" }, "prop", 1000 + COALESCE_MS - 1);
  assert.equal(h.stack.length, 2);        // baseline + one coalesced step
  assert.deepEqual(h.stack[h.idx], { t: "ab" });
  assert.deepEqual(h.undo(), { t: "" });  // single undo reverts the whole burst
});

test("same key outside window creates a new step", () => {
  const h = createHistory();
  h.reset({ t: "" });
  h.push({ t: "a" }, "prop", 1000);
  h.push({ t: "ab" }, "prop", 1000 + COALESCE_MS + 1);
  assert.equal(h.stack.length, 3);
});

test("different keys do not coalesce", () => {
  const h = createHistory();
  h.reset({});
  h.push({ a: 1 }, "k1", 1000);
  h.push({ a: 2 }, "k2", 1000);
  assert.equal(h.stack.length, 3);
});

test("stack is bounded by limit, dropping oldest", () => {
  const h = createHistory(3);
  h.reset({ v: 0 });
  for (let i = 1; i <= 5; i++) h.push({ v: i }, null, i * 1000);
  assert.equal(h.stack.length, 3);
  assert.deepEqual(h.stack[h.idx], { v: 5 });
  // can only undo within the retained window
  assert.deepEqual(h.undo(), { v: 4 });
  assert.deepEqual(h.undo(), { v: 3 });
  assert.equal(h.canUndo(), false);
});
