"use strict";
// Unit tests for the in-memory edit-lock store.
const { test } = require("node:test");
const assert = require("node:assert");
const { LockStore } = require("../locks");

const alice = { id: "u1", username: "alice" };
const bob = { id: "u2", username: "bob" };

test("acquire gives the lock; a second user is refused", () => {
  const s = new LockStore();
  const a = s.acquire("p", alice);
  assert.equal(a.ok, true);
  assert.equal(a.lock.username, "alice");
  const b = s.acquire("p", bob);
  assert.equal(b.ok, false);
  assert.equal(b.lock.username, "alice"); // reports the holder
});

test("re-acquiring by the holder refreshes and keeps 'since'", () => {
  const s = new LockStore();
  const a1 = s.acquire("p", alice);
  const a2 = s.acquire("p", alice);
  assert.equal(a2.ok, true);
  assert.equal(a2.lock.since, a1.lock.since);
});

test("force lets another user steal a live lock", () => {
  const s = new LockStore();
  s.acquire("p", alice);
  const b = s.acquire("p", bob, true);
  assert.equal(b.ok, true);
  assert.equal(b.lock.username, "bob");
});

test("expired locks are free again", () => {
  const s = new LockStore();
  s.acquire("p", alice);
  s.locks.get("p").expiresAt = Date.now() - 1; // force-expire
  assert.equal(s.get("p"), null);
  assert.equal(s.acquire("p", bob).ok, true); // now bob can take it
});

test("renew only works for the holder", () => {
  const s = new LockStore();
  s.acquire("p", alice);
  assert.equal(s.renew("p", alice).ok, true);
  assert.equal(s.renew("p", bob).ok, false);
});

test("release by holder frees it; a non-holder can't (unless forced)", () => {
  const s = new LockStore();
  s.acquire("p", alice);
  assert.equal(s.release("p", bob), false);
  assert.equal(s.release("p", alice), true);
  assert.equal(s.get("p"), null);
  s.acquire("p", alice);
  assert.equal(s.release("p", bob, true), true); // forced
});
