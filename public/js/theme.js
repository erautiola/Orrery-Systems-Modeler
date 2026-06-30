/* ============================================================================
 * theme.js — tiny, dual-environment (browser + Node) helpers for light/dark
 * theme resolution. Pure logic so it can be unit-tested; the DOM wiring lives
 * in app.js.
 * ==========================================================================*/
(function (root) {
  "use strict";

  const KEY = "osm-theme";

  // pick the initial theme: a valid stored choice wins; otherwise fall back to
  // the OS preference (light if the user prefers light, dark by default).
  function resolveInitial(stored, prefersLight) {
    return stored === "light" || stored === "dark" ? stored : (prefersLight ? "light" : "dark");
  }

  function nextTheme(cur) {
    return cur === "light" ? "dark" : "light";
  }

  const api = { KEY, resolveInitial, nextTheme };
  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node (tests)
  if (root) root.Theme = api;                                               // browser
})(typeof window !== "undefined" ? window : null);
