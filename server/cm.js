/* ============================================================================
 * cm.js — Project configuration management: version history (full snapshots) +
 * named baselines. File-based, no external database.
 *
 * Layout under <dir> (= <DATA_DIR>/.cm):
 *   <projectId>/v<rev>.json    — a full snapshot { rev, ts, author, message, model }
 *   <projectId>/history.json   — [{ rev, ts, author, message }] (ascending)
 *   <projectId>/baselines.json — [{ id, name, rev, by, notes, ts }]
 *
 * Snapshots are pruned to the most recent KEEP versions, but any baselined
 * revision is pinned and never pruned.
 * ==========================================================================*/
"use strict";
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

const KEEP = 100; // most-recent snapshots retained (plus all baselined revs)

class CmStore {
  constructor(dir) { this.dir = dir; }

  _pdir(pid) {
    if (typeof pid !== "string" || !/^[a-z0-9_-]+$/i.test(pid)) throw httpError(400, "Invalid project id");
    // path.basename strips any directory components — recognized sanitizer, so
    // the result can only be a plain sub-directory of this.dir (no traversal).
    return path.join(this.dir, path.basename(pid));
  }
  // a snapshot filename for a numeric revision (no user string reaches the path)
  _snap(pid, rev) { return path.join(this._pdir(pid), "v" + Number(rev) + ".json"); }
  async _readJson(file, dflt) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return dflt; } }
  async _writeJson(file, val) { await fs.writeFile(file, JSON.stringify(val)); }

  // append an immutable snapshot for a saved revision
  async recordVersion(pid, { rev, author, message, model }) {
    const d = this._pdir(pid);
    await fs.mkdir(d, { recursive: true });
    const ts = Date.now();
    await this._writeJson(this._snap(pid, rev), { rev, ts, author: author || null, message: message || "", model });
    const hist = await this._readJson(path.join(d, "history.json"), []);
    hist.push({ rev, ts, author: author || null, message: message || "" });
    await this._writeJson(path.join(d, "history.json"), hist);
    await this._prune(pid);
    return { rev, ts, author: author || null, message: message || "" };
  }

  async listVersions(pid) { return this._readJson(path.join(this._pdir(pid), "history.json"), []); }
  async getVersion(pid, rev) { return this._readJson(this._snap(pid, rev), null); }

  async listBaselines(pid) { return this._readJson(path.join(this._pdir(pid), "baselines.json"), []); }
  async createBaseline(pid, { name, rev, by, notes }) {
    const versions = await this.listVersions(pid);
    if (!versions.some((v) => v.rev === rev)) throw httpError(400, "That revision has no snapshot");
    const list = await this.listBaselines(pid);
    const b = { id: crypto.randomBytes(6).toString("hex"), name: String(name || "").trim() || `Baseline @ r${rev}`, rev, by: by || null, notes: String(notes || ""), ts: Date.now() };
    list.push(b);
    await this._writeJson(path.join(this._pdir(pid), "baselines.json"), list);
    return b;
  }
  async removeBaseline(pid, baselineId) {
    const list = (await this.listBaselines(pid)).filter((b) => b.id !== baselineId);
    await this._writeJson(path.join(this._pdir(pid), "baselines.json"), list);
  }

  // keep the most recent KEEP versions plus every baselined revision
  async _prune(pid) {
    const d = this._pdir(pid);
    const versions = await this._readJson(path.join(d, "history.json"), []);
    if (versions.length <= KEEP) return;
    const keep = new Set(versions.slice(-KEEP).map((v) => v.rev));
    for (const b of await this.listBaselines(pid)) keep.add(b.rev);
    for (const v of versions) if (!keep.has(v.rev)) { try { await fs.unlink(this._snap(pid, v.rev)); } catch { /* already gone */ } }
    await this._writeJson(path.join(d, "history.json"), versions.filter((v) => keep.has(v.rev)));
  }

  async removeProject(pid) { try { await fs.rm(this._pdir(pid), { recursive: true, force: true }); } catch { /* nothing to remove */ } }
}

module.exports = { CmStore, httpError };
