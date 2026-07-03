"use strict";
// Unit tests for scrypt password hashing.
const { test } = require("node:test");
const assert = require("node:assert");
const { hashPassword, verifyPassword } = require("../auth");

test("hash then verify round-trips; wrong password fails", () => {
  const h = hashPassword("s3cret-pw!");
  assert.ok(verifyPassword("s3cret-pw!", h));
  assert.ok(!verifyPassword("wrong", h));
});

test("stored form is scrypt$N$r$p$salt$hash", () => {
  assert.match(hashPassword("x"), /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/);
});

test("verify tolerates garbage without throwing", () => {
  assert.ok(!verifyPassword("x", "not-a-hash"));
  assert.ok(!verifyPassword("x", ""));
  assert.ok(!verifyPassword("x", null));
  assert.ok(!verifyPassword("x", "scrypt$bad"));
});

test("same password hashes differently (random salt)", () => {
  assert.notEqual(hashPassword("same"), hashPassword("same"));
});
