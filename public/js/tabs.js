/* ============================================================================
 * tabs.js — Pure open-tabs model for the diagram/table view strip.
 *
 * A "tab" is a plain { kind, id } pair (kind: 'diagram' | 'table'). The list is
 * an ordered array of open tabs. All operations are pure (return new arrays),
 * so the reducer is unit-tested under Node and the UI in app.js just renders
 * whatever these return.
 * ==========================================================================*/
(function (global) {
  "use strict";

  function same(a, b) { return !!a && !!b && a.kind === b.kind && a.id === b.id; }
  function indexOf(tabs, tab) { return tabs.findIndex((t) => same(t, tab)); }
  function has(tabs, tab) { return indexOf(tabs, tab) >= 0; }

  // append the tab if it isn't already open; always returns a new array
  function add(tabs, tab) {
    if (has(tabs, tab)) return tabs.slice();
    return tabs.concat([{ kind: tab.kind, id: tab.id }]);
  }

  function remove(tabs, tab) { return tabs.filter((t) => !same(t, tab)); }

  // which tab should become active after `tab` is closed: the next one to the
  // right, else the new last one, else null when nothing remains
  function next(tabs, tab) {
    const i = indexOf(tabs, tab);
    const rest = remove(tabs, tab);
    if (!rest.length) return null;
    if (i < 0) return rest[rest.length - 1];
    return rest[Math.min(i, rest.length - 1)];
  }

  // drop tabs whose target no longer exists (exists(kind, id) -> bool)
  function prune(tabs, exists) { return tabs.filter((t) => exists(t.kind, t.id)); }

  const api = { same, indexOf, has, add, remove, next, prune };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.Tabs = api;
})(typeof window !== "undefined" ? window : globalThis);
