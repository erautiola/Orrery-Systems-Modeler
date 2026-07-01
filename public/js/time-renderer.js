/* ============================================================================
 * time-renderer.js — Bespoke renderer for Timing diagrams. Each timeline is a
 * band with state lanes on the left and a step function across a time axis.
 * Bands stack vertically (in diagram.nodes order). Returns the same layer shape
 * as the other renderers so the editor's view code (pan/zoom/fit) is reused.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";
  const MARGIN = 30, LW = 140, HEAD = 22, LANE = 26, BOT = 20, UNIT = 42, GAP = 20;

  let PAL = { edge: "#9fb0cf", edgeText: "#e6ecf5" };
  function readPalette() {
    try {
      const cs = getComputedStyle(document.documentElement);
      const g = (k, d) => (cs.getPropertyValue(k).trim() || d);
      return { edge: g("--edge", "#9fb0cf"), edgeText: g("--edge-text", "#e6ecf5") };
    } catch (e) { return PAL; }
  }

  function render(svg, model, diagram, opts) {
    opts = opts || {};
    PAL = readPalette();
    clear(svg); svg.appendChild(defs());
    const root = el("g", { class: "viewport" });
    const edgeLayer = el("g", { class: "edges" });
    const nodeLayer = el("g", { class: "nodes" });
    const overlay = el("g", { class: "overlay" });
    root.appendChild(edgeLayer); root.appendChild(nodeLayer); root.appendChild(overlay);
    svg.appendChild(root);

    const timelines = [];
    for (const n of diagram.nodes) {
      const e = Model.elementById(model, n.elementId);
      if (e && e.type === "timeline") timelines.push(e);
    }

    const absById = new Map();
    let y = MARGIN;
    for (const tl of timelines) {
      const states = tl.states && tl.states.length ? tl.states : ["(state)"];
      const tMax = Math.max(1, tl.tMax || 10);
      const plotW = tMax * UNIT;
      const bandH = HEAD + states.length * LANE + BOT;
      absById.set(tl.id, { x: MARGIN, y, w: LW + plotW, h: bandH });

      const g = el("g", { class: "uml-node", "data-id": tl.id, transform: `translate(${MARGIN},${y})` });
      g.appendChild(el("rect", { class: "node-bg", width: LW + plotW, height: bandH, rx: 4, fill: "#fff" }));
      g.appendChild(text(8, 15, tl.name, { "font-weight": 700, "font-size": 12, fill: "#1a2236" }));
      g.appendChild(el("line", { x1: LW, y1: 0, x2: LW, y2: bandH, stroke: "#c2cbe0" }));

      const laneY = (s) => { const i = Math.max(0, states.indexOf(s)); return HEAD + i * LANE + LANE / 2; };
      // state labels + lane guide lines
      states.forEach((s, i) => {
        const ly = HEAD + i * LANE + LANE / 2;
        g.appendChild(text(LW - 8, ly + 4, s, { "text-anchor": "end", "font-size": 11, fill: "#1a2236" }));
        g.appendChild(el("line", { x1: LW, y1: ly, x2: LW + plotW, y2: ly, stroke: "#eef1f6", "stroke-dasharray": "2 4" }));
      });

      // time axis ticks
      const step = tMax > 20 ? 5 : (tMax > 10 ? 2 : 1);
      for (let t = 0; t <= tMax; t += step) {
        const x = LW + t * UNIT;
        g.appendChild(el("line", { x1: x, y1: bandH - BOT + 2, x2: x, y2: bandH - BOT + 8, stroke: PAL.edge }));
        g.appendChild(text(x, bandH - 4, String(t), { "text-anchor": "middle", "font-size": 10, fill: PAL.edgeText }));
      }

      // step function
      const segs = buildSegments(tl, tMax);
      let prev = null;
      for (const seg of segs) {
        const x0 = LW + clamp(seg.t0, 0, tMax) * UNIT, x1 = LW + clamp(seg.t1, 0, tMax) * UNIT, ly = laneY(seg.state);
        if (prev && prev.ly !== ly) g.appendChild(el("line", { x1: x0, y1: prev.ly, x2: x0, y2: ly, stroke: PAL.edge, "stroke-width": 2 }));
        g.appendChild(el("line", { x1: x0, y1: ly, x2: x1, y2: ly, stroke: PAL.edge, "stroke-width": 2 }));
        prev = { ly };
      }

      nodeLayer.appendChild(g);
      y += bandH + GAP;
    }

    const layers = { root, edgeLayer, nodeLayer, overlay, absById, containers: [] };
    if (opts.selection && opts.selection.kind === "element") {
      const node = nodeLayer.querySelector(`.uml-node[data-id="${cssEsc(opts.selection.id)}"] .node-bg`);
      if (node) { node.setAttribute("stroke", "#5b9bff"); node.setAttribute("stroke-width", "2.4"); }
    }
    return layers;
  }

  function buildSegments(tl, tMax) {
    const states = tl.states || [];
    const changes = (tl.changes || []).slice().filter((c) => c && c.state != null).sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!changes.length) return [{ t0: 0, t1: tMax, state: states[0] || "" }];
    const segs = [];
    if ((changes[0].at || 0) > 0) segs.push({ t0: 0, t1: changes[0].at, state: states[0] || changes[0].state });
    for (let k = 0; k < changes.length; k++) {
      const t0 = changes[k].at || 0;
      const t1 = k + 1 < changes.length ? (changes[k + 1].at || 0) : tMax;
      segs.push({ t0, t1, state: changes[k].state });
    }
    return segs;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function el(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function text(x, y, s, attrs) { const t = el("text", { x, y, ...attrs }); t.textContent = s; return t; }
  function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function defs() { const d = el("defs", {}); const p = el("pattern", { id: "grid", width: 26, height: 26, patternUnits: "userSpaceOnUse" }); p.appendChild(el("path", { d: "M 26 0 L 0 0 0 26", fill: "none", stroke: "#182033", "stroke-width": 1 })); d.appendChild(p); return d; }

  global.TimeRenderer = { render };
})(window);
