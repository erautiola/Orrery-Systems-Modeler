/* ============================================================================
 * auth.js — Password hashing using Node's built-in scrypt (no dependencies).
 *
 * Stored form:  scrypt$N$r$p$saltB64$hashB64
 * scrypt is memory-hard; parameters are encoded in the hash so they can evolve
 * without breaking existing hashes. Verification is constant-time.
 * ==========================================================================*/
"use strict";
const crypto = require("crypto");

const N = 16384, R = 8, P = 1, KEYLEN = 32; // ~16MB work, well under scrypt's default maxmem

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(String(password), salt, expected.length, { N: +n, r: +r, p: +p });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
