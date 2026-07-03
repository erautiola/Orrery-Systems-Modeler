/* ============================================================================
 * sessions.js — File-based server-side session store (no dependencies).
 *
 * A session id is an unguessable random token; the client holds it in an
 * HttpOnly cookie. Sessions are server-side so they can be revoked (logout,
 * account disabled). Expired sessions are pruned on load and on access.
 * ==========================================================================*/
"use strict";
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ID_RE = /^[a-f0-9]{64}$/; // session ids are 32 random bytes as hex

class SessionStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "sessions.json");
    // null-prototype map so a hostile session id (e.g. "__proto__") can never
    // pollute Object.prototype when used as a key
    this.sessions = Object.create(null);
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    let loaded = {};
    try { loaded = JSON.parse(await fs.readFile(this.file, "utf8")); } catch { loaded = {}; }
    this.sessions = Object.assign(Object.create(null), loaded);
    await this._gc();
  }

  async _save() { await fs.writeFile(this.file, JSON.stringify(this.sessions)); }
  async _gc() {
    const now = Date.now(); let changed = false;
    for (const [id, s] of Object.entries(this.sessions)) if (s.expiresAt <= now) { delete this.sessions[id]; changed = true; }
    if (changed) await this._save();
  }

  async create(userId) {
    const id = crypto.randomBytes(32).toString("hex");
    this.sessions[id] = { userId, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS };
    await this._save();
    return id;
  }
  get(id) {
    if (!ID_RE.test(String(id))) return null; // reject non-token keys
    const s = this.sessions[id];
    if (!s) return null;
    if (s.expiresAt <= Date.now()) { delete this.sessions[id]; return null; }
    return s;
  }
  async destroy(id) {
    if (!ID_RE.test(String(id))) return;
    if (this.sessions[id]) { delete this.sessions[id]; await this._save(); }
  }
  async destroyUser(userId) {
    let changed = false;
    for (const [id, s] of Object.entries(this.sessions)) if (s.userId === userId) { delete this.sessions[id]; changed = true; }
    if (changed) await this._save();
  }
}

module.exports = { SessionStore };
