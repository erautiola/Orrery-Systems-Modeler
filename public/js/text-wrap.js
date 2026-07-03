/* ============================================================================
 * text-wrap.js — Greedy word-wrapping for SVG labels.
 *
 * SVG <text> does not wrap, so the renderers break long labels into lines
 * themselves. `wrapLines` is pure (the pixel measurer is injected) so it runs
 * both in the browser (measuring via a canvas 2d context) and under Node for
 * unit tests (measuring via a simple stub).
 * ==========================================================================*/
(function (global) {
  "use strict";

  // wrapLines(str, maxWidth, measure) -> string[]
  //   measure(text) returns the rendered pixel width of `text`.
  // Greedy: pack whole words onto a line until the next word would overflow;
  // a single word wider than maxWidth is hard-broken at the character level so
  // it can never spill outside the box.
  function wrapLines(str, maxWidth, measure) {
    str = String(str == null ? "" : str);
    const words = str.split(/\s+/).filter((w) => w.length);
    if (!words.length) return [""];
    if (!(maxWidth > 0)) return [str]; // no room to reason about; caller clamps

    const lines = [];
    let cur = "";
    for (let word of words) {
      // hard-break a word that is itself wider than the line
      while (measure(word) > maxWidth && word.length > 1) {
        let i = 1;
        while (i < word.length && measure(word.slice(0, i + 1)) <= maxWidth) i++;
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(word.slice(0, i));
        word = word.slice(i);
      }
      const trial = cur ? cur + " " + word : word;
      if (cur && measure(trial) > maxWidth) { lines.push(cur); cur = word; }
      else cur = trial;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  const api = { wrapLines };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.TextWrap = api;
})(typeof window !== "undefined" ? window : globalThis);
