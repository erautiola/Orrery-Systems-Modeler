/* ============================================================================
 * seq-renderer.js — Bespoke renderer for Sequence (interaction) diagrams.
 * Lifelines are vertical; messages are horizontal arrows positioned by their
 * `y` value (drag to reorder). Activation bars are drawn on message receivers.
 *
 * Returns the same layer shape as Renderer.render (root/edgeLayer/nodeLayer/
 * overlay/absById/containers) so the editor's view code (pan/zoom/fit) is reused.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";
  const HEAD_TOP = 16, HEAD_H = 36, MIN_BOTTOM = 360, GAP = 44;
  const _cv = document.createElement("canvas"); const _ctx = _cv.getContext("2d");
  const tw = (s) => { _ctx.font = "600 13px 'Segoe UI', sans-serif"; return _ctx.measureText(s || "").width; };

  function headWidth(el) { return Math.max(90, tw(el.name + (el.represents ? " : " + el.represents : "")) + 28); }

  function render(svg, model, diagram, opts) {
    opts = opts || {};
    clear(svg); svg.appendChild(defs());
    const root = g("g", { class: "viewport" });
    const edgeLayer = g("g", { class: "edges" });
    const nodeLayer = g("g", { class: "nodes" });
    const overlay = g("g", { class: "overlay" });
    root.appendChild(edgeLayer); root.appendChild(nodeLayer); root.appendChild(overlay);
    svg.appendChild(root);

    // lifelines present on this diagram
    const lines = [];
    for (const n of diagram.nodes) {
      const el = Model.elementById(model, n.elementId);
      if (el && el.type === "lifeline") lines.push({ el, n, cx: n.x });
    }
    const lineById = new Map(lines.map((l) => [l.el.id, l]));

    // messages = msg relationships whose both ends are placed lifelines
    const msgs = model.relationships
      .filter((r) => Model.RELATIONSHIPS[r.type] && Model.RELATIONSHIPS[r.type].msg && lineById.has(r.sourceId) && lineById.has(r.targetId))
      .sort((a, b) => (a.y || 0) - (b.y || 0));

    const lineBottom = Math.max(MIN_BOTTOM, (msgs.length ? msgs[msgs.length - 1].y + 60 : 0) + GAP);

    // activation bars: a bar on a receiver from a non-reply msg to the next
    // reply it sends back (or +28 fallback)
    const activations = computeActivations(msgs);
    for (const a of activations) {
      const lx = lineById.get(a.lineId); if (!lx) continue;
      edgeLayer.appendChild(g("rect", { x: lx.cx - 5, y: a.y1, width: 10, height: Math.max(16, a.y2 - a.y1), fill: "#cfe0ff", stroke: "#5b9bff", "stroke-width": 1 }));
    }

    // messages
    for (const r of msgs) edgeLayer.appendChild(drawMessage(r, lineById));

    // lifelines (heads + dashed lines) — drawn above activations
    const absById = new Map();
    for (const l of lines) {
      const hw = headWidth(l.el), x = l.cx - hw / 2;
      const grp = g("g", { class: "uml-node", "data-id": l.el.id, transform: `translate(0,0)` });
      grp.appendChild(g("line", { x1: l.cx, y1: HEAD_TOP + HEAD_H, x2: l.cx, y2: lineBottom, stroke: "transparent", "stroke-width": 14 })); // hit area
      grp.appendChild(g("line", { x1: l.cx, y1: HEAD_TOP + HEAD_H, x2: l.cx, y2: lineBottom, stroke: "#9fb0cf", "stroke-width": 1.2, "stroke-dasharray": "6 5" }));
      grp.appendChild(g("rect", { class: "node-bg", x, y: HEAD_TOP, width: hw, height: HEAD_H, rx: 4, fill: "#e8eefb", stroke: "#3a4a6b", "stroke-width": 1.2 }));
      const label = l.el.represents ? l.el.name + " : " + l.el.represents : l.el.name;
      grp.appendChild(text(l.cx, HEAD_TOP + 23, label, { "text-anchor": "middle", "font-weight": 700, "font-size": 13, fill: "#1a2236" }));
      nodeLayer.appendChild(grp);
      absById.set(l.el.id, { x, y: HEAD_TOP, w: hw, h: lineBottom - HEAD_TOP });
    }

    const layers = { root, edgeLayer, nodeLayer, overlay, absById, containers: [] };
    if (opts.selection) drawSelection(layers, opts.selection, lineById);
    return layers;

    function drawMessage(r, lineById) {
      const s = lineById.get(r.sourceId), t = lineById.get(r.targetId);
      const spec = Model.RELATIONSHIPS[r.type];
      const y = r.y || HEAD_TOP + HEAD_H + 20;
      const grp = g("g", { class: "edge", "data-id": r.id });
      const dashed = spec.line === "dashed";
      const label = Model.messageLabel(r);
      if (r.sourceId === r.targetId) { // self message
        const x = s.cx, w = 46;
        grp.appendChild(g("rect", { x: x - 2, y: y - 8, width: w + 8, height: 30, fill: "transparent" }));
        grp.appendChild(g("path", { d: `M ${x} ${y} H ${x + w} V ${y + 20} H ${x}`, fill: "none", stroke: "#9fb0cf", "stroke-width": 1.4, "stroke-dasharray": dashed ? "7 5" : "none", class: "edge-line" }));
        grp.appendChild(arrow(spec.targetEnd, { x, y: y + 20 }, Math.PI));
        if (label) grp.appendChild(text(x + w + 8, y + 4, label, { "font-size": 11, fill: "#e6ecf5" }));
        return grp;
      }
      const x1 = s.cx, x2 = t.cx, dir = x2 >= x1 ? 1 : -1;
      grp.appendChild(g("line", { x1, y1: y, x2, y2: y, stroke: "transparent", "stroke-width": 12, class: "edge-hit" }));
      grp.appendChild(g("line", { x1, y1: y, x2: x2 - dir * 6, y2: y, stroke: "#9fb0cf", "stroke-width": 1.5, "stroke-dasharray": dashed ? "7 5" : "none", class: "edge-line" }));
      grp.appendChild(arrow(spec.targetEnd, { x: x2 - dir * 5, y }, dir > 0 ? 0 : Math.PI));
      if (spec.destroy) { // X at target
        const xx = x2; grp.appendChild(g("line", { x1: xx - 6, y1: y - 6, x2: xx + 6, y2: y + 6, stroke: "#f87171", "stroke-width": 2 }));
        grp.appendChild(g("line", { x1: xx - 6, y1: y + 6, x2: xx + 6, y2: y - 6, stroke: "#f87171", "stroke-width": 2 }));
      }
      if (label) grp.appendChild(text((x1 + x2) / 2, y - 6, label, { "text-anchor": "middle", "font-size": 11, fill: "#e6ecf5" }));
      return grp;
    }
  }

  function computeActivations(msgs) {
    // simple: each non-reply message starts a short activation on its receiver
    const acts = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.type === "msgReply" || m.sourceId === m.targetId) continue;
      // find the next reply from this receiver back to the sender
      let y2 = m.y + 28;
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].type === "msgReply" && msgs[j].sourceId === m.targetId) { y2 = msgs[j].y; break; }
      }
      acts.push({ lineId: m.targetId, y1: m.y, y2 });
    }
    return acts;
  }

  function arrow(kind, p, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c;
    if (kind === "triangleFilled") {
      const L = 12, W = 6, bx = p.x - c * L, by = p.y - s * L;
      return g("polygon", { points: `${p.x},${p.y} ${bx + nx * W},${by + ny * W} ${bx - nx * W},${by - ny * W}`, fill: "#9fb0cf", stroke: "#9fb0cf" });
    }
    const L = 12, W = 6, bx = p.x - c * L, by = p.y - s * L, gg = g("g", {});
    gg.appendChild(g("line", { x1: bx + nx * W, y1: by + ny * W, x2: p.x, y2: p.y, stroke: "#9fb0cf", "stroke-width": 1.5 }));
    gg.appendChild(g("line", { x1: bx - nx * W, y1: by - ny * W, x2: p.x, y2: p.y, stroke: "#9fb0cf", "stroke-width": 1.5 }));
    return gg;
  }

  function drawSelection(layers, sel) {
    if (sel.kind === "element") {
      const node = layers.nodeLayer.querySelector(`.uml-node[data-id="${cssEsc(sel.id)}"]`);
      if (node) { const r = node.querySelector(".node-bg"); if (r) { r.setAttribute("stroke", "#5b9bff"); r.setAttribute("stroke-width", "2.4"); } }
    } else {
      const ln = layers.edgeLayer.querySelector(`.edge[data-id="${cssEsc(sel.id)}"] .edge-line`);
      if (ln) { ln.setAttribute("stroke", "#5b9bff"); ln.setAttribute("stroke-width", "2.5"); }
    }
  }

  function g(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function text(x, y, s, attrs) { const t = g("text", { x, y, ...attrs }); t.textContent = s; return t; }
  function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function defs() { const d = g("defs", {}); const p = g("pattern", { id: "grid", width: 26, height: 26, patternUnits: "userSpaceOnUse" }); p.appendChild(g("path", { d: "M 26 0 L 0 0 0 26", fill: "none", stroke: "#182033", "stroke-width": 1 })); d.appendChild(p); return d; }

  global.SeqRenderer = { render, HEAD_TOP, HEAD_H };
})(window);
