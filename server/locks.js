/* ============================================================================
 * locks.js — In-memory project edit locks (check-out / check-in).
 *
 * Exclusive editing: while a user holds a project's lock, others are read-only.
 * Locks live only in memory (a single on-prem server) and auto-expire after a
 * short TTL, so a crashed or closed client never blocks a project for long.
 * The client heartbeats to renew while it is actively editing.
 *
 * Keys are project ids and are kept in a Map (immune to prototype pollution).
 * ==========================================================================*/
"use strict";

const TTL_MS = 2 * 60 * 1000; // a lock is live for 2 minutes between heartbeats

class LockStore {
  constructor() { this.locks = new Map(); }

  // the live lock on a project, or null (also drops an expired one)
  get(pid) {
    const l = this.locks.get(pid);
    if (!l) return null;
    if (l.expiresAt <= Date.now()) { this.locks.delete(pid); return null; }
    return l;
  }

  // acquire/refresh the lock for `user`. Fails (ok:false) if another user holds
  // a live lock and `force` isn't set (force is granted only to owners/admins
  // by the caller). Returns { ok, lock } where lock is the current holder.
  acquire(pid, user, force) {
    const cur = this.get(pid);
    if (cur && cur.userId !== user.id && !force) return { ok: false, lock: pubLock(cur) };
    const since = cur && cur.userId === user.id ? cur.since : Date.now();
    const lock = { userId: user.id, username: user.username, since, expiresAt: Date.now() + TTL_MS };
    this.locks.set(pid, lock);
    return { ok: true, lock: pubLock(lock) };
  }

  // renew — only the current holder may; ok:false means the lock was lost
  renew(pid, user) {
    const cur = this.get(pid);
    if (!cur || cur.userId !== user.id) return { ok: false, lock: cur ? pubLock(cur) : null };
    cur.expiresAt = Date.now() + TTL_MS;
    return { ok: true, lock: pubLock(cur) };
  }

  // release — the holder, or a forced release (owner/admin)
  release(pid, user, force) {
    const cur = this.locks.get(pid);
    if (!cur) return true;
    if (force || cur.userId === user.id) { this.locks.delete(pid); return true; }
    return false;
  }

  removeProject(pid) { this.locks.delete(pid); }
}

function pubLock(l) { return l && { userId: l.userId, username: l.username, since: l.since, expiresAt: l.expiresAt }; }

module.exports = { LockStore };
