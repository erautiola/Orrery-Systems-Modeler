/* ============================================================================
 * sessions.js — File-based server-side session store (no dependencies).
 *
 * A session id is an unguessable random token; the client holds it in an
 * HttpOnly cookie. Sessions are server-side so they can be revoked (logout,
 * account disabled). Sessions are kept in a Map (immune to prototype pollution
 * from a hostile session id) and serialized to a plain JSON object on disk.
 * Expired sessions are pruned on load and on access.
 * ==========================================================================*/
"use strict";
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

class SessionStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "sessions.json");
    this.sessions = new Map();
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    let loaded = {};
    try { loaded = JSON.parse(await fs.readFile(this.file, "utf8")); } catch { loaded = {}; }
    this.sessions = new Map(Object.entries(loaded));
    await this._gc();
  }

  async _save() { await fs.writeFile(this.file, JSON.stringify(Object.fromEntries(this.sessions))); }
  async _gc() {
    const now = Date.now(); let changed = false;
    for (const [id, s] of this.sessions) if (s.expiresAt <= now) { this.sessions.delete(id); changed = true; }
    if (changed) await this._save();
  }

  async create(userId) {
    const id = crypto.randomBytes(32).toString("hex");
    this.sessions.set(id, { userId, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS });
    await this._save();
    return id;
  }
  get(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.expiresAt <= Date.now()) { this.sessions.delete(id); return null; }
    return s;
  }
  async destroy(id) { if (this.sessions.delete(id)) await this._save(); }
  async destroyUser(userId) {
    let changed = false;
    for (const [id, s] of this.sessions) if (s.userId === userId) { this.sessions.delete(id); changed = true; }
    if (changed) await this._save();
  }
}

module.exports = { SessionStore };
