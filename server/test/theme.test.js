"use strict";
// Unit tests for the theme resolution helpers (public/js/theme.js).
const { test } = require("node:test");
const assert = require("node:assert");
const Theme = require("../../public/js/theme.js");

test("resolveInitial honours a valid stored value", () => {
  assert.equal(Theme.resolveInitial("light", false), "light");
  assert.equal(Theme.resolveInitial("dark", true), "dark");
});

test("resolveInitial falls back to OS preference when unset/invalid", () => {
  assert.equal(Theme.resolveInitial(null, true), "light");
  assert.equal(Theme.resolveInitial(null, false), "dark");
  assert.equal(Theme.resolveInitial(undefined, false), "dark");
  assert.equal(Theme.resolveInitial("bogus", true), "light");
});

test("nextTheme toggles", () => {
  assert.equal(Theme.nextTheme("light"), "dark");
  assert.equal(Theme.nextTheme("dark"), "light");
});
