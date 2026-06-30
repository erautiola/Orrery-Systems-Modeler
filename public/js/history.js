/* ============================================================================
 * history.js — Undo/redo as a bounded stack of model snapshots.
 *
 * Pure index/stack logic (no DOM, no clock) so it's unit-testable; the caller
 * supplies snapshots, a coalesce key, and the current time. Consecutive edits
 * with the same key inside COALESCE_MS replace the top entry instead of growing
 * the stack (so a burst of typing is one undo step). Dual-environment.
 * ==========================================================================*/
(function (root) {
  "use strict";

  const COALESCE_MS = 700;

  function createHistory(limit) {
    return {
      stack: [], idx: -1, lastKey: null, lastTime: 0,
      limit: limit || 100,

      reset(snapshot) { this.stack = [snapshot]; this.idx = 0; this.lastKey = null; this.lastTime = 0; },

      // record a new snapshot (post-change). `key` enables coalescing.
      push(snapshot, key, now) {
        now = now || 0;
        if (key && key === this.lastKey && (now - this.lastTime) <= COALESCE_MS && this.idx >= 0) {
          this.stack[this.idx] = snapshot;             // coalesce into current step
        } else {
          this.stack = this.stack.slice(0, this.idx + 1); // drop any redo future
          this.stack.push(snapshot);
          this.idx = this.stack.length - 1;
          if (this.stack.length > this.limit) { this.stack.shift(); this.idx--; }
        }
        this.lastKey = key || null;
        this.lastTime = now;
      },

      canUndo() { return this.idx > 0; },
      canRedo() { return this.idx < this.stack.length - 1; },

      undo() { if (!this.canUndo()) return null; this.idx--; this.lastKey = null; return this.stack[this.idx]; },
      redo() { if (!this.canRedo()) return null; this.idx++; this.lastKey = null; return this.stack[this.idx]; },
    };
  }

  const api = { createHistory, COALESCE_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node (tests)
  if (root) root.History = api;                                             // browser
})(typeof window !== "undefined" ? window : null);
