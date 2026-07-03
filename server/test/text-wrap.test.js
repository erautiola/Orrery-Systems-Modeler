"use strict";
// Unit tests for the pure word-wrapping helper. A stub measurer treats every
// character as 10px wide, so "maxWidth" is effectively a character budget.
const { test } = require("node:test");
const assert = require("node:assert");
const { wrapLines } = require("../../public/js/text-wrap.js");

const measure = (s) => s.length * 10; // 10px per char

test("short text stays on one line", () => {
  assert.deepEqual(wrapLines("Order Service", 200, measure), ["Order Service"]);
});

test("wraps on word boundaries when too wide", () => {
  // budget 12 chars: "Order" + " " + "Management" would be 16 chars -> break
  const lines = wrapLines("Order Management Controller", 120, measure);
  assert.ok(lines.length >= 2, "wrapped into multiple lines");
  for (const l of lines) assert.ok(measure(l) <= 120, `line fits: "${l}"`);
});

test("hard-breaks a single word wider than the box", () => {
  const lines = wrapLines("Supercalifragilistic", 80, measure); // 20 chars, budget 8
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.ok(measure(l) <= 80);
  assert.equal(lines.join(""), "Supercalifragilistic"); // no characters lost
});

test("empty / nullish text yields a single empty line", () => {
  assert.deepEqual(wrapLines("", 100, measure), [""]);
  assert.deepEqual(wrapLines(null, 100, measure), [""]);
  assert.deepEqual(wrapLines(undefined, 100, measure), [""]);
});

test("collapses runs of whitespace", () => {
  assert.deepEqual(wrapLines("A   B", 100, measure), ["A B"]);
});

test("non-positive width returns the text unbroken", () => {
  assert.deepEqual(wrapLines("hello world", 0, measure), ["hello world"]);
});
