"use strict";
// Unit tests for the pure open-tabs reducer.
const { test } = require("node:test");
const assert = require("node:assert");
const Tabs = require("../../public/js/tabs.js");

const D = (id) => ({ kind: "diagram", id });
const T = (id) => ({ kind: "table", id });

test("add appends and de-dupes by kind+id", () => {
  let tabs = [];
  tabs = Tabs.add(tabs, D("a"));
  tabs = Tabs.add(tabs, D("b"));
  tabs = Tabs.add(tabs, D("a")); // dup -> no change in length
  assert.deepEqual(tabs, [D("a"), D("b")]);
  // a diagram and a table with the same id are distinct tabs
  tabs = Tabs.add(tabs, T("a"));
  assert.equal(tabs.length, 3);
});

test("add returns a new array (pure)", () => {
  const a = [D("a")];
  const b = Tabs.add(a, D("b"));
  assert.notEqual(a, b);
  assert.equal(a.length, 1);
});

test("has / same match on kind+id", () => {
  const tabs = [D("a"), T("b")];
  assert.ok(Tabs.has(tabs, D("a")));
  assert.ok(!Tabs.has(tabs, T("a")));
  assert.ok(Tabs.same(D("x"), { kind: "diagram", id: "x" }));
  assert.ok(!Tabs.same(D("x"), T("x")));
});

test("remove drops the matching tab", () => {
  const tabs = [D("a"), D("b"), D("c")];
  assert.deepEqual(Tabs.remove(tabs, D("b")), [D("a"), D("c")]);
});

test("next picks the tab to the right, else the new last, else null", () => {
  const tabs = [D("a"), D("b"), D("c")];
  assert.deepEqual(Tabs.next(tabs, D("b")), D("c")); // right neighbour
  assert.deepEqual(Tabs.next(tabs, D("c")), D("b")); // last -> new last
  assert.deepEqual(Tabs.next([D("a")], D("a")), null); // nothing left
});

test("prune drops tabs whose target no longer exists", () => {
  const tabs = [D("a"), D("gone"), T("k")];
  const alive = new Set(["diagram:a", "table:k"]);
  const pruned = Tabs.prune(tabs, (kind, id) => alive.has(kind + ":" + id));
  assert.deepEqual(pruned, [D("a"), T("k")]);
});
