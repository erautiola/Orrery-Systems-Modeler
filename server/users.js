/* ============================================================================
 * users.js — File-based user account store (no external database).
 *
 * Accounts live in one JSON file under an auth directory (kept separate from the
 * project library). Passwords are stored only as scrypt hashes. A first admin
 * can be bootstrapped from ADMIN_USER / ADMIN_PASSWORD on an empty store.
 *
 * Global roles: "admin" (manage users/everything) | "user".
 * ==========================================================================*/
"use strict";
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { hashPassword, verifyPassword } = require("./auth");

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{2,40}$/;
const MIN_PASSWORD = 8;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

class UserStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "users.json");
    this.users = [];
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    try { this.users = JSON.parse(await fs.readFile(this.file, "utf8")); }
    catch { this.users = []; }
    // bootstrap the first admin from the environment if the store is empty
    if (!this.users.length && process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
      await this.create({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASSWORD, role: "admin" });
    }
  }

  async _save() { await fs.writeFile(this.file, JSON.stringify(this.users, null, 2)); }

  byUsername(name) {
    const n = String(name || "").toLowerCase();
    return this.users.find((u) => u.username.toLowerCase() === n);
  }
  byId(id) { return this.users.find((u) => u.id === id); }

  // the shape safe to send to clients (no hash / lockout internals)
  pub(u) { return u && { id: u.id, username: u.username, role: u.role, status: u.status }; }
  list() { return this.users.map((u) => this.pub(u)); }
  // richer shape for the admin page (still no password hash)
  details() { return this.users.map((u) => ({ id: u.id, username: u.username, role: u.role, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })); }
  activeCount() { return this.users.filter((u) => u.status === "active").length; }
  adminCount() { return this.users.filter((u) => u.role === "admin" && u.status === "active").length; }

  async setRole(id, role) {
    const u = this.byId(id); if (!u) throw httpError(404, "No such user");
    u.role = role === "admin" ? "admin" : "user";
    await this._save(); return this.pub(u);
  }

  async create({ username, password, role }) {
    username = String(username || "").trim();
    if (!USERNAME_RE.test(username)) throw httpError(400, "Username must be 2–40 chars (letters, digits, . _ -)");
    if (this.byUsername(username)) throw httpError(409, "That username is taken");
    if (String(password || "").length < MIN_PASSWORD) throw httpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
    const u = {
      id: crypto.randomBytes(8).toString("hex"),
      username,
      role: role === "admin" ? "admin" : "user",
      status: "active",
      passwordHash: hashPassword(password),
      createdAt: Date.now(), lastLoginAt: null,
      failed: 0, lockedUntil: 0,
    };
    this.users.push(u);
    await this._save();
    return this.pub(u);
  }

  async remove(id) {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.id !== id);
    if (this.users.length !== before) await this._save();
  }
  async setStatus(id, status) {
    const u = this.byId(id); if (!u) throw httpError(404, "No such user");
    u.status = status === "disabled" ? "disabled" : "active";
    await this._save(); return this.pub(u);
  }
  async setPassword(id, password) {
    const u = this.byId(id); if (!u) throw httpError(404, "No such user");
    if (String(password || "").length < MIN_PASSWORD) throw httpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
    u.passwordHash = hashPassword(password); u.failed = 0; u.lockedUntil = 0;
    await this._save();
  }

  // verify credentials with lockout after repeated failures; returns pub user
  async login(username, password) {
    const now = Date.now();
    const u = this.byUsername(username);
    // run a hash even on unknown users to blunt timing/username enumeration
    if (!u || u.status !== "active") { verifyPassword(password, "scrypt$16384$8$1$AA==$AA=="); throw httpError(401, "Invalid username or password"); }
    if (u.lockedUntil && u.lockedUntil > now) throw httpError(429, "Account temporarily locked — try again later");
    if (!verifyPassword(password, u.passwordHash)) {
      u.failed = (u.failed || 0) + 1;
      if (u.failed >= MAX_FAILED) { u.lockedUntil = now + LOCK_MS; u.failed = 0; }
      await this._save();
      throw httpError(401, "Invalid username or password");
    }
    u.failed = 0; u.lockedUntil = 0; u.lastLoginAt = now;
    await this._save();
    return this.pub(u);
  }
}

module.exports = { UserStore, httpError };
