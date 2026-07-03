/* ============================================================================
 * renderer.js — Render an internal-model diagram to SVG with proper UML/SysML
 * notation, including nested containment (composite states / packages), and
 * draw selection / resize handles for the editor.
 *
 * Renderer.render(svg, model, diagram, {selection}) returns layer references
 * plus `absById` (absolute geometry of every node) and `containers` (so the
 * editor can place/re-parent nested elements). Node geometry lives on
 * diagram.nodes (x,y,w,h); for nested nodes x/y are relative to the parent's
 * content origin.
 * ==========================================================================*/
(function (global) {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";
  const PADX = 12, LINE = 16, HEADPAD = 8, NAME_H = 20, STEREO_H = 15, MINW = 120, MINH = 60;
  const NAME_LH = 17, MAXW = 380; // wrapped-name line height; max auto width
  const C_PAD = 16, C_MINW = 170, C_MINH = 110; // composite container padding / minimums

  const _cv = document.createElement("canvas");
  const _ctx = _cv.getContext("2d");
  const F_NAME = "700 14px 'Segoe UI', sans-serif";
  const F_STEREO = "italic 12px 'Segoe UI', sans-serif";
  const F_FEAT = "11px 'Cascadia Code', Consolas, monospace";
  const tw = (s, f) => { _ctx.font = f; return _ctx.measureText(s || "").width; };
  const VIS = { public: "+", private: "−", protected: "#", package: "~" };

  // wrap an element name to fit a box `w` wide (in the bold name font)
  function nameLines(name, w) {
    return TextWrap.wrapLines(name || "", Math.max(20, w - PADX * 2), (s) => tw(s, F_NAME));
  }
  // header height for a box whose name occupies `n` wrapped lines
  function headHeight(n, stereo) {
    return HEADPAD * 2 + NAME_H + (stereo ? STEREO_H : 0) + Math.max(0, n - 1) * NAME_LH;
  }
  // wrap a requirement's tag rows ("id = …", "text = …") to the box width,
  // returning every display line (feature font) so long text tags wrap.
  function requirementTagLines(el, w) {
    const out = [];
    const max = Math.max(24, w - PADX * 2);
    for (const k of Object.keys(el.tags || {})) {
      const s = k + " = " + (el.tags[k] || "");
      for (const ln of TextWrap.wrapLines(s, max, (x) => tw(x, F_FEAT))) out.push(ln);
    }
    return out;
  }
  // append a centered, possibly multi-line label; returns the text node
  function centeredLines(g, cx, firstBaseline, lines, lineH, attrs) {
    const t = el2("text", { x: cx, "text-anchor": "middle", ...attrs });
    lines.forEach((ln, i) => {
      const ts = el2("tspan", { x: cx, y: firstBaseline + i * lineH });
      ts.textContent = ln;
      t.appendChild(ts);
    });
    g.appendChild(t);
    return t;
  }

  // theme-aware diagram palette, refreshed from CSS variables on each render()
  let PAL = { edge: "#9fb0cf", edgeText: "#e6ecf5", edgeDim: "#c6d2e8", canvas: "#0c111b" };
  function readPalette() {
    try {
      const cs = getComputedStyle(document.documentElement);
      const g = (k, d) => (cs.getPropertyValue(k).trim() || d);
      return { edge: g("--edge", "#9fb0cf"), edgeText: g("--edge-text", "#e6ecf5"),
        edgeDim: g("--edge-text-dim", "#c6d2e8"), canvas: g("--canvas", "#0c111b") };
    } catch (e) { return PAL; }
  }

  // ---- feature formatting ------------------------------------------------
  function attrLine(a) {
    let s = (VIS[a.visibility] || "+") + " " + (a.isDerived ? "/" : "") + (a.name || "");
    if (a.type) s += ": " + a.type;
    if (a.multiplicity) s += " [" + a.multiplicity + "]";
    if (a.defaultValue) s += " = " + a.defaultValue;
    return { text: s, statik: a.isStatic };
  }
  function opLine(o) {
    const ps = (o.params || []).map((p) => (p.name || "") + (p.type ? ":" + p.type : "")).join(", ");
    let s = (VIS[o.visibility] || "+") + " " + (o.name || "") + "(" + ps + ")";
    if (o.returnType) s += ": " + o.returnType;
    return { text: s, statik: o.isStatic, abstract: o.isAbstract };
  }
  function compartmentItems(el, comp) {
    if (comp === "attributes") return (el.attributes || []).map(attrLine);
    if (comp === "operations") return (el.operations || []).map(opLine);
    if (comp === "literals") return (el.literals || []).map((l) => ({ text: l }));
    return [];
  }
  // ER column display: "PK id : INT *"  (* = NOT NULL)
  function colDisplay(c, isFk) {
    let pre = c.pk ? "PK " : (isFk ? "FK " : "");
    let s = pre + (c.name || "");
    if (c.dataType) s += " : " + c.dataType;
    if (c.unique && !c.pk) s += " U";
    if (c.nullable === false) s += " *";
    return { text: s, pk: c.pk };
  }
  // entry/exit/do internal-activity lines for a state
  function stateActivities(el) {
    const out = [];
    if (el.entry) out.push("entry / " + el.entry);
    if (el.exit) out.push("exit / " + el.exit);
    if (el.doActivity) out.push("do / " + el.doActivity);
    for (const o of (el.operations || [])) out.push(opLine(o).text);
    return out;
  }

  // ---- sizing (leaves) ---------------------------------------------------
  function computeSize(el) {
    const spec = Model.ELEMENTS[el.type] || Model.ELEMENTS.class;
    if (spec.fixedSize) return { w: spec.fixedSize[0], h: spec.fixedSize[1] };
    if (spec.shape === "actor") return { w: 60, h: 96 };
    if (spec.shape === "usecase") return { w: Math.max(110, tw(el.name, F_NAME) + 50), h: 64 };
    if (spec.shape === "note") {
      const lines = (el.name || "").split("\n");
      return { w: Math.min(Math.max(120, ...lines.map((l) => tw(l, F_FEAT) + 28)), 320), h: Math.max(50, lines.length * LINE + 18) };
    }
    if (spec.shape === "state") {
      const acts = stateActivities(el);
      let w = Math.max(120, tw(el.name, F_NAME) + 24);
      for (const a of acts) w = Math.max(w, tw(a, F_FEAT) + 20);
      const h = 30 + (acts.length ? acts.length * LINE + 8 : 0);
      return { w: Math.round(w), h: Math.round(Math.max(h, 44)) };
    }
    if (spec.shape === "dbtable") {
      const cols = el.columns || [];
      let w = Math.max(150, tw(el.name, F_NAME) + 28);
      for (const c of cols) w = Math.max(w, tw(colDisplay(c, false).text, F_FEAT) + 36);
      const h = 28 + Math.max(cols.length ? cols.length * LINE + 8 : 14, 14);
      return { w: Math.round(Math.min(w, 360)), h: Math.round(h) };
    }
    if (spec.shape === "action") return { w: Math.max(100, tw(el.name, F_NAME) + 32), h: 44 };
    if (spec.shape === "objectnode") return { w: Math.max(90, tw(el.name, F_NAME) + 24), h: 38 };
    if (spec.shape === "object") return { w: Math.max(100, tw(el.name, F_NAME) + 28), h: 40 };
    if (spec.shape === "partition") return { w: 200, h: 240 }; // base; grows to fit children
    if (spec.shape === "valueprop") {
      const t = el.name + (el.valueType ? " : " + el.valueType : "") + (el.value ? " = " + el.value : "");
      return { w: Math.max(90, tw(t, F_FEAT) + 24), h: 36 };
    }
    if (spec.shape === "constraintprop") {
      const ps = el.parameters || [];
      let w = Math.max(140, tw(el.name, F_NAME) + 28);
      if (el.expression) w = Math.max(w, tw("{" + el.expression + "}", F_FEAT) + 24);
      for (const p of ps) w = Math.max(w, tw(p, F_FEAT) + 24);
      const h = 30 + (el.expression ? LINE : 0) + Math.max(ps.length * LINE + 6, 6);
      return { w: Math.round(Math.min(w, 360)), h: Math.round(h) };
    }

    const stereo = Model.stereoText(el);
    let w = Math.max(MINW, tw(el.name, F_NAME) + PADX * 2);
    if (stereo) w = Math.max(w, tw(stereo, F_STEREO) + PADX * 2);
    const comps = (spec.compartments || []).map((c) => compartmentItems(el, c));
    for (const items of comps) for (const it of items) w = Math.max(w, tw(it.text, F_FEAT) + PADX * 2);
    if (spec.shape === "requirement") w = Math.max(w, 220); // readable width for the wrapped text tag
    w = Math.min(w, MAXW);
    let h = headHeight(nameLines(el.name, w).length, stereo);
    if (spec.shape === "requirement") h += requirementTagLines(el, w).length * LINE + 8;
    for (const items of comps) h += Math.max(items.length ? items.length * LINE + 8 : 10, 10);
    return { w: Math.round(w), h: Math.round(Math.max(h, MINH)) };
  }

  // ---- accents -----------------------------------------------------------
  function accent(el) {
    const st = (el.stereotypes || []).map((s) => s.toLowerCase());
    if (el.type === "block" || st.includes("block")) return { head: "#ffe9d6", bar: "#ff9e64" };
    if (el.type === "requirement" || st.includes("requirement")) return { head: "#fde2e2", bar: "#f87171" };
    if (el.type === "interfaceBlock") return { head: "#e0f7ef", bar: "#34d399" };
    if (el.type === "valueType" || el.type === "constraint") return { head: "#f0e6ff", bar: "#c084fc" };
    switch (el.type) {
      case "interface": return { head: "#dff5ea", bar: "#34d399" };
      case "enumeration": return { head: "#f0e6ff", bar: "#c084fc" };
      case "datatype": case "primitive": return { head: "#eceff5", bar: "#8a97b0" };
      case "component": return { head: "#fff2d9", bar: "#f6c453" };
      case "actor": case "usecase": return { head: "#dde9ff", bar: "#5b9bff" };
      case "state": return { head: "#e3ecff", bar: "#5b9bff" };
      case "action": return { head: "#eef5ff", bar: "#5b9bff" };
      case "dbtable": return { head: "#dcefe9", bar: "#1E9C8C" };
      case "part": return { head: "#e8f0ff", bar: "#5b9bff" };
      default: return { head: "#e8eefb", bar: "#5b9bff" };
    }
  }

  // ---- containment helpers ----------------------------------------------
  function isContainer(el, hasKids) {
    return (el.type === "state" && (el.isComposite || hasKids)) ||
           (el.type === "package" && hasKids) ||
           el.type === "partition";
  }
  // where children start inside a container (relative to the container box)
  function contentOrigin(el, node) {
    if (el.type === "package") return { dx: 6, dy: 22 };
    if (el.type === "partition") return { dx: 8, dy: 28 };
    // composite state: below the title + internal activities
    return { dx: C_PAD, dy: node._titleH || compositeTitleH(el) };
  }
  function compositeTitleH(el) {
    const acts = stateActivities(el);
    return 28 + (acts.length ? acts.length * LINE + 6 : 0);
  }

  // ---- node drawing (shape only; children appended by caller) ------------
  function drawShape(g, el, node) {
    const spec = Model.ELEMENTS[el.type] || Model.ELEMENTS.class;
    const W = node.w, H = node.h;
    switch (spec.shape) {
      case "actor": drawActor(g, el, W, H); break;
      case "usecase": drawUsecase(g, el, W, H); break;
      case "package": drawPackage(g, el, W, H, node._isContainer); break;
      case "component": drawClassifier(g, el, node, true); break;
      case "requirement": drawRequirement(g, el, node); break;
      case "state": drawState(g, el, node); break;
      case "dbtable": drawDbTable(g, el, node); break;
      case "action": drawAction(g, el, W, H); break;
      case "objectnode": drawObjectNode(g, el, W, H); break;
      case "object": drawObject(g, el, W, H); break;
      case "constraintprop": drawConstraintProp(g, el, node); break;
      case "valueprop": drawValueProp(g, el, W, H); break;
      case "partition": drawPartition(g, el, node); break;
      case "flowfinal":
        g.appendChild(el2("circle", { cx: W / 2, cy: H / 2, r: 12, fill: "#fff", stroke: "#1a2236", "stroke-width": 1.5 }));
        g.appendChild(el2("line", { x1: W / 2 - 7, y1: H / 2 - 7, x2: W / 2 + 7, y2: H / 2 + 7, stroke: "#1a2236", "stroke-width": 1.6 }));
        g.appendChild(el2("line", { x1: W / 2 - 7, y1: H / 2 + 7, x2: W / 2 + 7, y2: H / 2 - 7, stroke: "#1a2236", "stroke-width": 1.6 })); break;
      case "part": drawPart(g, el, W, H); break;
      case "note": drawNote(g, el, W, H); break;
      case "forkjoin": g.appendChild(el2("rect", { width: W, height: H, rx: 2, fill: "#1a2236" })); break;
      case "junction": g.appendChild(el2("circle", { cx: W / 2, cy: H / 2, r: 8, fill: "#1a2236" })); break;
      case "history":
        g.appendChild(el2("circle", { cx: W / 2, cy: H / 2, r: 11, fill: "#fff", stroke: "#1a2236", "stroke-width": 1.5 }));
        g.appendChild(text(W / 2, H / 2 + 4, el.deep ? "H*" : "H", { "text-anchor": "middle", "font-weight": 700, "font-size": 12, fill: "#1a2236" })); break;
      case "initial": g.appendChild(el2("circle", { cx: W / 2, cy: H / 2, r: 9, fill: "#1a2236" })); break;
      case "final":
        g.appendChild(el2("circle", { cx: W / 2, cy: H / 2, r: 12, fill: "#fff", stroke: "#1a2236", "stroke-width": 1.5 }));
        g.appendChild(el2("circle", { cx: W / 2, cy: H / 2, r: 6, fill: "#1a2236" })); break;
      case "choice":
        g.appendChild(el2("polygon", { points: `${W/2},2 ${W-2},${H/2} ${W/2},${H-2} 2,${H/2}`, fill: "#e3ecff", stroke: "#5b9bff", "stroke-width": 1.4 })); break;
      case "port":
        g.appendChild(el2("rect", { width: W, height: H, fill: "#e8f0ff", stroke: "#3a4a6b", "stroke-width": 1.4 }));
        if (el.name) g.appendChild(text(W + 4, H / 2 + 4, el.name, { "font-size": 11, fill: PAL.edgeDim })); break;
      default: drawClassifier(g, el, node, false);
    }
  }

  function drawClassifier(g, el, node, component) {
    const spec = Model.ELEMENTS[el.type];
    const W = node.w, H = node.h, ac = accent(el);
    const stereo = Model.stereoText(el);
    const lines = nameLines(el.name, W);
    const headH = headHeight(lines.length, stereo);
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, rx: 4 }));
    g.appendChild(el2("rect", { class: "node-head", width: W, height: headH, rx: 4, fill: ac.head }));
    g.appendChild(el2("rect", { y: headH - 4, width: W, height: 4, fill: ac.head }));
    g.appendChild(el2("rect", { width: 4, height: H, fill: ac.bar, rx: 2 }));
    if (component) {
      g.appendChild(el2("rect", { x: W - 22, y: 8, width: 16, height: 12, fill: "#fff", stroke: "#3a4a6b" }));
      g.appendChild(el2("rect", { x: W - 26, y: 10, width: 8, height: 3, fill: "#fff", stroke: "#3a4a6b" }));
      g.appendChild(el2("rect", { x: W - 26, y: 15, width: 8, height: 3, fill: "#fff", stroke: "#3a4a6b" }));
    }
    let y = HEADPAD + 11;
    if (stereo) { g.appendChild(text(W / 2, y, stereo, { "text-anchor": "middle", "font-style": "italic", "font-size": 12, fill: "#6b4ea8" })); y += STEREO_H; }
    centeredLines(g, W / 2, y + 6, lines, NAME_LH, { "font-weight": 700, "font-size": 14,
      "font-style": el.isAbstract ? "italic" : "normal", "text-decoration": spec.underline ? "underline" : "none", fill: "#1a2236" });
    let cy = headH;
    for (const comp of (spec.compartments || [])) cy = drawCompartment(g, compartmentItems(el, comp), cy, W);
  }
  function drawCompartment(g, items, cy, W) {
    g.appendChild(el2("line", { x1: 0, y1: cy, x2: W, y2: cy, stroke: "#c2cbe0" }));
    let y = cy + 14;
    for (const it of items) {
      const a = { class: "feature", "font-size": 11, fill: "#1a2236", "font-family": "'Cascadia Code', Consolas, monospace" };
      if (it.statik) a["text-decoration"] = "underline";
      if (it.abstract) a["font-style"] = "italic";
      g.appendChild(text(PADX, y, it.text, a)); y += LINE;
    }
    return cy + Math.max(items.length ? items.length * LINE + 8 : 10, 10);
  }

  function drawRequirement(g, el, node) {
    const W = node.w, H = node.h, ac = accent(el);
    const lines = nameLines(el.name, W);
    const headH = headHeight(lines.length, true);
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, rx: 4 }));
    g.appendChild(el2("rect", { class: "node-head", width: W, height: headH, rx: 4, fill: ac.head }));
    g.appendChild(el2("rect", { y: headH - 4, width: W, height: 4, fill: ac.head }));
    g.appendChild(el2("rect", { width: 4, height: H, fill: ac.bar, rx: 2 }));
    g.appendChild(text(W / 2, HEADPAD + 11, "«requirement»", { "text-anchor": "middle", "font-style": "italic", "font-size": 12, fill: "#6b4ea8" }));
    centeredLines(g, W / 2, HEADPAD + 28, lines, NAME_LH, { "font-weight": 700, "font-size": 14, fill: "#1a2236" });
    let cy = headH; g.appendChild(el2("line", { x1: 0, y1: cy, x2: W, y2: cy, stroke: "#c2cbe0" }));
    let y = cy + 14;
    for (const ln of requirementTagLines(el, W)) { g.appendChild(text(PADX, y, ln, { "font-size": 11, fill: "#1a2236", "font-family": "'Cascadia Code', monospace" })); y += LINE; }
  }

  function drawPackage(g, el, W, H, container) {
    const tabW = Math.min(W * 0.45, 90);
    g.appendChild(el2("rect", { x: 0, y: 0, width: tabW, height: 16, fill: "#fce9b8", stroke: "#caa64a" }));
    g.appendChild(el2("rect", { class: "node-bg", x: 0, y: 14, width: W, height: H - 14, fill: "#fff7e3", stroke: "#caa64a", rx: 2 }));
    g.appendChild(text(container ? 10 : W / 2, container ? 30 : 14 + (H - 14) / 2 + 4, el.name,
      { "text-anchor": container ? "start" : "middle", "font-weight": 700, "font-size": 14, fill: "#1a2236" }));
  }

  function drawActor(g, el, W, H) {
    const cx = W / 2, s = { stroke: "#1a2236", "stroke-width": 2, fill: "none" };
    g.appendChild(el2("circle", { cx, cy: 14, r: 10, ...s }));
    g.appendChild(el2("line", { x1: cx, y1: 24, x2: cx, y2: 54, ...s }));
    g.appendChild(el2("line", { x1: cx - 18, y1: 34, x2: cx + 18, y2: 34, ...s }));
    g.appendChild(el2("line", { x1: cx, y1: 54, x2: cx - 16, y2: 78, ...s }));
    g.appendChild(el2("line", { x1: cx, y1: 54, x2: cx + 16, y2: 78, ...s }));
    g.appendChild(text(cx, H - 2, el.name, { "text-anchor": "middle", "font-weight": 600, "font-size": 13, fill: PAL.edgeText }));
  }
  function drawUsecase(g, el, W, H) {
    g.appendChild(el2("ellipse", { cx: W / 2, cy: H / 2, rx: W / 2 - 2, ry: H / 2 - 2, fill: "#dde9ff", stroke: "#3a4a6b", "stroke-width": 1.3 }));
    g.appendChild(text(W / 2, H / 2 + 4, el.name, { "text-anchor": "middle", "font-weight": 600, "font-size": 13, fill: "#1a2236" }));
  }
  function drawDbTable(g, el, node) {
    const W = node.w, H = node.h, ac = accent(el);
    const fk = node._fkCols || new Set();
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, rx: 4, fill: "#fff" }));
    g.appendChild(el2("rect", { class: "node-head", width: W, height: 26, rx: 4, fill: ac.head }));
    g.appendChild(el2("rect", { y: 22, width: W, height: 4, fill: ac.head }));
    g.appendChild(el2("rect", { width: 4, height: H, fill: ac.bar, rx: 2 }));
    g.appendChild(text(W / 2, 17, el.name, { "text-anchor": "middle", "font-weight": 700, "font-size": 13, fill: "#1a2236" }));
    g.appendChild(el2("line", { x1: 0, y1: 26, x2: W, y2: 26, stroke: "#c2cbe0" }));
    let y = 40;
    for (const c of (el.columns || [])) {
      const d = colDisplay(c, fk.has(c.name));
      const a = { x: PADX, y, "font-size": 11, fill: "#1a2236", "font-family": "'Cascadia Code', Consolas, monospace" };
      if (d.pk) { a["font-weight"] = "700"; a["text-decoration"] = "underline"; }
      g.appendChild(text(PADX, y, d.text, a));
      y += LINE;
    }
  }

  function drawAction(g, el, W, H) {
    const ac = accent(el);
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, rx: 16, fill: "#eef5ff", stroke: ac.bar, "stroke-width": 1.3 }));
    g.appendChild(text(W / 2, H / 2 + 4, el.name, { "text-anchor": "middle", "font-weight": 600, "font-size": 13, fill: "#1a2236" }));
  }
  function drawObjectNode(g, el, W, H) {
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, fill: "#fff", stroke: "#3a4a6b", "stroke-width": 1.3 }));
    g.appendChild(text(W / 2, H / 2 + 4, el.name, { "text-anchor": "middle", "font-weight": 600, "font-size": 12, fill: "#1a2236" }));
  }
  function drawObject(g, el, W, H) {
    const ac = accent(el);
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, rx: 3, fill: "#eef4ff", stroke: ac.bar, "stroke-width": 1.3 }));
    g.appendChild(text(W / 2, H / 2 + 4, el.name, { "text-anchor": "middle", "font-weight": 600, "font-size": 13, "text-decoration": "underline", fill: "#1a2236" }));
  }
  function drawPartition(g, el, node) {
    const W = node.w, H = node.h;
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, fill: "rgba(91,155,255,0.04)", stroke: "#5b9bff", "stroke-width": 1.2 }));
    g.appendChild(el2("rect", { width: W, height: 24, fill: "#dde9ff" }));
    g.appendChild(el2("line", { x1: 0, y1: 24, x2: W, y2: 24, stroke: "#5b9bff" }));
    g.appendChild(text(W / 2, 16, el.name, { "text-anchor": "middle", "font-weight": 700, "font-size": 12, fill: "#1a2236" }));
  }

  function drawConstraintProp(g, el, node) {
    const W = node.w, H = node.h, ac = { head: "#f0e6ff", bar: "#c084fc" };
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, rx: 10, fill: "#fff", stroke: ac.bar, "stroke-width": 1.3 }));
    g.appendChild(el2("rect", { width: W, height: 26, rx: 10, fill: ac.head }));
    g.appendChild(el2("rect", { y: 14, width: W, height: 12, fill: ac.head }));
    g.appendChild(text(W / 2, 11, "«constraint»", { "text-anchor": "middle", "font-style": "italic", "font-size": 10, fill: "#6b4ea8" }));
    g.appendChild(text(W / 2, 22, el.name, { "text-anchor": "middle", "font-weight": 700, "font-size": 12, fill: "#1a2236" }));
    let y = 40;
    if (el.expression) { g.appendChild(text(W / 2, y, "{" + el.expression + "}", { "text-anchor": "middle", "font-size": 11, fill: "#1a2236", "font-family": "'Cascadia Code', monospace" })); y += LINE; }
    for (const p of (el.parameters || [])) { g.appendChild(text(PADX, y, p, { "font-size": 11, fill: "#1a2236", "font-family": "'Cascadia Code', monospace" })); y += LINE; }
  }
  function drawValueProp(g, el, W, H) {
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, rx: 3, fill: "#eef4ff", stroke: "#3a4a6b", "stroke-width": 1.2 }));
    const t = el.name + (el.valueType ? " : " + el.valueType : "") + (el.value ? " = " + el.value : "");
    g.appendChild(text(W / 2, H / 2 + 4, t, { "text-anchor": "middle", "font-size": 12, fill: "#1a2236" }));
  }

  function drawPart(g, el, W, H) {
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, rx: 4, fill: "#eef4ff", stroke: "#3a4a6b", "stroke-width": 1.3 }));
    const label = el.name + (el.attributes && el.attributes[0] && el.attributes[0].type ? " : " + el.attributes[0].type : "");
    g.appendChild(text(W / 2, 20, label, { "text-anchor": "middle", "font-weight": 600, "font-size": 13, fill: "#1a2236" }));
  }
  function drawNote(g, el, W, H) {
    const f = 12;
    g.appendChild(el2("path", { d: `M0 0 H${W - f} L${W} ${f} V${H} H0 Z`, fill: "#fff8d6", stroke: "#caa64a", "stroke-width": 1.2 }));
    g.appendChild(el2("path", { d: `M${W - f} 0 V${f} H${W}`, fill: "none", stroke: "#caa64a", "stroke-width": 1.2 }));
    let y = 16;
    for (const ln of (el.name || "").split("\n")) { g.appendChild(text(8, y, ln, { "font-size": 11, fill: "#5a4a1a", "font-family": "'Cascadia Code', monospace" })); y += LINE; }
  }

  function drawState(g, el, node) {
    const W = node.w, H = node.h, ac = accent(el);
    const acts = stateActivities(el);
    g.appendChild(el2("rect", { class: "node-bg", width: W, height: H, rx: 12, fill: "#fff" }));
    if (node._isContainer) {
      // composite: title bar + content region (+ optional orthogonal regions)
      const titleH = node._titleH || compositeTitleH(el);
      g.appendChild(el2("rect", { width: W, height: 26, rx: 12, fill: ac.head }));
      g.appendChild(el2("rect", { y: 14, width: W, height: 12, fill: ac.head }));
      g.appendChild(text(W / 2, 17, el.name, { "text-anchor": "middle", "font-weight": 700, "font-size": 13, fill: "#1a2236" }));
      g.appendChild(el2("line", { x1: 0, y1: 26, x2: W, y2: 26, stroke: "#c2cbe0" }));
      let y = 40;
      for (const a of acts) { g.appendChild(text(PADX, y, a, { "font-size": 11, fill: "#1a2236", "font-family": "'Cascadia Code', monospace" })); y += LINE; }
      if (acts.length) g.appendChild(el2("line", { x1: 0, y1: titleH - 4, x2: W, y2: titleH - 4, stroke: "#dde3ee", "stroke-dasharray": "3 3" }));
      const regions = Math.max(1, el.regions || 1);
      for (let i = 1; i < regions; i++) {
        const ry = titleH + (H - titleH) * (i / regions);
        g.appendChild(el2("line", { x1: 0, y1: ry, x2: W, y2: ry, stroke: PAL.edge, "stroke-dasharray": "6 4" }));
      }
    } else {
      g.appendChild(el2("rect", { width: W, height: 26, rx: 12, fill: ac.head }));
      g.appendChild(el2("rect", { y: 14, width: W, height: 12, fill: ac.head }));
      g.appendChild(text(W / 2, 17, el.name, { "text-anchor": "middle", "font-weight": 700, "font-size": 13, fill: "#1a2236" }));
      if (acts.length) {
        g.appendChild(el2("line", { x1: 0, y1: 26, x2: W, y2: 26, stroke: "#c2cbe0" }));
        let y = 40;
        for (const a of acts) { g.appendChild(text(PADX, y, a, { "font-size": 11, fill: "#1a2236", "font-family": "'Cascadia Code', monospace" })); y += LINE; }
      }
    }
  }

  // ---- ports (SysML IBD) -------------------------------------------------
  function drawPort(el, cx, cy, edge) {
    const g = el2("g", { class: "uml-node", "data-id": el.id, transform: `translate(${cx},${cy})` });
    g.appendChild(el2("rect", { x: -12, y: -12, width: 24, height: 24, fill: "transparent" })); // easier click target
    g.appendChild(el2("rect", { class: "node-bg", x: -8, y: -8, width: 16, height: 16, fill: "#e8f0ff", stroke: "#3a4a6b", "stroke-width": 1.3 }));
    const nrm = ({ right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1] })[edge] || [1, 0];
    if (el.direction === "in" || el.direction === "out") { // flow-direction triangle
      const sgn = el.direction === "out" ? 1 : -1, ux = nrm[0] * sgn, uy = nrm[1] * sgn, px = -uy, py = ux;
      const pts = `${ux * 7},${uy * 7} ${-ux + px * 4},${-uy + py * 4} ${-ux - px * 4},${-uy - py * 4}`;
      g.appendChild(el2("polygon", { points: pts, fill: PAL.edge, stroke: PAL.edge }));
    }
    const lbl = Model.portLabel(el);
    if (lbl) {
      let tx = 0, ty = 4, anchor = "middle";
      if (edge === "right") { tx = 12; anchor = "start"; }
      else if (edge === "left") { tx = -12; anchor = "end"; }
      else if (edge === "top") { ty = -12; }
      else { ty = 20; }
      g.appendChild(text(tx, ty, lbl, { "text-anchor": anchor, "font-size": 11, fill: PAL.edgeText }));
    }
    return g;
  }
  function snapPort(o, px, py) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, dx = px - cx, dy = py - cy;
    const rx = (o.w / 2) || 1, ry = (o.h / 2) || 1;
    if (Math.abs(dx) / rx >= Math.abs(dy) / ry)
      return { x: cx + (dx >= 0 ? rx : -rx), y: Math.max(o.y + 8, Math.min(o.y + o.h - 8, py)), edge: dx >= 0 ? "right" : "left" };
    return { x: Math.max(o.x + 8, Math.min(o.x + o.w - 8, px)), y: cy + (dy >= 0 ? ry : -ry), edge: dy >= 0 ? "bottom" : "top" };
  }

  // ---- edges -------------------------------------------------------------
  function drawEdge(rel, absById) {
    const s = absById.get(rel.sourceId), t = absById.get(rel.targetId);
    if (!s || !t) return null;
    const spec = Model.RELATIONSHIPS[rel.type] || Model.RELATIONSHIPS.association;
    const g = el2("g", { class: "edge", "data-id": rel.id });
    const dashed = spec.line === "dashed";
    const labelText = rel.type === "transition" ? Model.transitionLabel(rel)
      : rel.type === "controlflow" ? (rel.guard ? "[" + rel.guard + "]" : (rel.name || ""))
      : rel.type === "commMsg" ? Model.commLabel(rel)
      : rel.type === "itemflow" ? (Model.flowLabel(rel) ? "«flow» " + Model.flowLabel(rel) : "«flow»")
      : (rel.name || rel.label || (spec.keyword ? "«" + spec.keyword + "»" : ""));

    if (rel.sourceId === rel.targetId) { // self-transition loop
      const x = s.x + s.w * 0.7, y = s.y, r = 16;
      g.appendChild(el2("path", { d: `M ${x} ${y} C ${x + r} ${y - r * 2}, ${x + r * 2.4} ${y + r}, ${x + r * 0.6} ${y + r * 1.2}`, fill: "none", stroke: PAL.edge, "stroke-width": 1.5, "stroke-dasharray": dashed ? "7 5" : "none", class: "edge-line" }));
      g.appendChild(marker(spec.targetEnd || "open", { x: x + r * 0.6, y: y + r * 1.2 }, Math.PI * 0.75));
      if (labelText) g.appendChild(text(x + r * 2.4, y, labelText, { "font-size": 11, fill: PAL.edgeText }));
      return g;
    }

    const sc = { x: s.x + s.w / 2, y: s.y + s.h / 2 }, tc = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    const p1 = border(s, tc), p2 = border(t, sc);
    g.appendChild(el2("line", { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: "transparent", "stroke-width": 12, class: "edge-hit" }));
    const path = el2("line", { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: PAL.edge, "stroke-width": 1.5, class: "edge-line" });
    if (dashed) path.setAttribute("stroke-dasharray", "7 5");
    g.appendChild(path);
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    if (spec.targetEnd && spec.targetEnd !== "none") g.appendChild(marker(spec.targetEnd, p2, ang));
    if (spec.sourceEnd && spec.sourceEnd !== "none") g.appendChild(marker(spec.sourceEnd, p1, ang + Math.PI));
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    if (rel.type === "itemflow") g.appendChild(marker("triangleFilled", { x: mid.x, y: mid.y }, ang)); // flow direction
    if (labelText) g.appendChild(text(mid.x, mid.y - 5, labelText, { "text-anchor": "middle", "font-size": 11, fill: PAL.edgeText }));
    if (rel.sourceRole) g.appendChild(text(p1.x + Math.cos(ang) * 18, p1.y + Math.sin(ang) * 18 + 12, rel.sourceRole, { "font-size": 10, fill: PAL.edgeDim, "text-anchor": "middle" }));
    if (rel.targetRole) g.appendChild(text(p2.x - Math.cos(ang) * 18, p2.y - Math.sin(ang) * 18 + 12, rel.targetRole, { "font-size": 10, fill: PAL.edgeDim, "text-anchor": "middle" }));
    if (rel.sourceMult) g.appendChild(text(p1.x + Math.cos(ang) * 16, p1.y + Math.sin(ang) * 16 - 4, rel.sourceMult, { "font-size": 11, fill: PAL.edgeDim, "text-anchor": "middle" }));
    if (rel.targetMult) g.appendChild(text(p2.x - Math.cos(ang) * 16, p2.y - Math.sin(ang) * 16 - 4, rel.targetMult, { "font-size": 11, fill: PAL.edgeDim, "text-anchor": "middle" }));
    return g;
  }

  function marker(kind, p, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c;
    if (kind === "open") {
      const L = 13, W = 7, bx = p.x - c * L, by = p.y - s * L, g = el2("g", {});
      g.appendChild(el2("line", { x1: bx + nx * W, y1: by + ny * W, x2: p.x, y2: p.y, stroke: PAL.edge, "stroke-width": 1.5 }));
      g.appendChild(el2("line", { x1: bx - nx * W, y1: by - ny * W, x2: p.x, y2: p.y, stroke: PAL.edge, "stroke-width": 1.5 }));
      return g;
    }
    if (kind === "triangleHollow" || kind === "triangleFilled") {
      const L = 14, W = 9, bx = p.x - c * L, by = p.y - s * L;
      return el2("polygon", { points: `${p.x},${p.y} ${bx + nx * W},${by + ny * W} ${bx - nx * W},${by - ny * W}`, fill: kind === "triangleFilled" ? PAL.edge : PAL.canvas, stroke: PAL.edge, "stroke-width": 1.5 });
    }
    if (kind === "diamondHollow" || kind === "diamondFilled") {
      const L = 16, W = 7, ex = p.x + c * L, ey = p.y + s * L, mx = p.x + c * (L / 2), my = p.y + s * (L / 2);
      return el2("polygon", { points: `${p.x},${p.y} ${mx + nx * W},${my + ny * W} ${ex},${ey} ${mx - nx * W},${my - ny * W}`, fill: kind === "diamondFilled" ? PAL.edge : PAL.canvas, stroke: PAL.edge, "stroke-width": 1.5 });
    }
    if (kind === "crowsfoot") { // "many" — three prongs fanning onto the entity
      const L = 14, W = 8, bx = p.x - c * L, by = p.y - s * L, g = el2("g", {});
      g.appendChild(el2("line", { x1: bx, y1: by, x2: p.x, y2: p.y, stroke: PAL.edge, "stroke-width": 1.4 }));
      g.appendChild(el2("line", { x1: bx, y1: by, x2: p.x + nx * W, y2: p.y + ny * W, stroke: PAL.edge, "stroke-width": 1.4 }));
      g.appendChild(el2("line", { x1: bx, y1: by, x2: p.x - nx * W, y2: p.y - ny * W, stroke: PAL.edge, "stroke-width": 1.4 }));
      return g;
    }
    if (kind === "barone") { // "one" — a single perpendicular tick
      const D = 11, W = 7, mx = p.x - c * D, my = p.y - s * D;
      return el2("line", { x1: mx + nx * W, y1: my + ny * W, x2: mx - nx * W, y2: my - ny * W, stroke: PAL.edge, "stroke-width": 1.6 });
    }
    return el2("g", {});
  }
  function border(n, toward) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2, dx = toward.x - cx, dy = toward.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const sx = dx === 0 ? Infinity : (n.w / 2) / Math.abs(dx);
    const sy = dy === 0 ? Infinity : (n.h / 2) / Math.abs(dy);
    const k = Math.min(sx, sy);
    return { x: cx + dx * k, y: cy + dy * k };
  }

  // ---- main --------------------------------------------------------------
  function render(svg, model, diagram, opts) {
    opts = opts || {};
    PAL = readPalette();
    clear(svg);
    svg.appendChild(defs());
    const root = el2("g", { class: "viewport" });
    const edgeLayer = el2("g", { class: "edges" });
    const nodeLayer = el2("g", { class: "nodes" });
    const overlay = el2("g", { class: "overlay" });
    root.appendChild(edgeLayer); root.appendChild(nodeLayer); root.appendChild(overlay);
    svg.appendChild(root);

    // index placed nodes & containment among placed
    const entryById = new Map();
    for (const n of diagram.nodes) {
      const el = Model.elementById(model, n.elementId);
      if (el) entryById.set(el.id, { el, node: n });
    }
    // ports are drawn in their own pass (snapped to their owner's border), so
    // they are excluded from the generic containment graph.
    const ports = [...entryById.values()].filter((e) => e.el.type === "port");
    const kids = new Map();
    for (const e of entryById.values()) {
      if (e.el.type === "port") continue;
      const owner = e.el.ownerId;
      if (owner && entryById.has(owner)) {
        if (!kids.has(owner)) kids.set(owner, []);
        kids.get(owner).push(e);
      }
    }
    const roots = [...entryById.values()].filter((e) =>
      e.el.type !== "port" && !(e.el.ownerId && entryById.has(e.el.ownerId)));

    // measure (post-order): leaves from content, containers grow to fit kids
    function measure(e) {
      const childList = kids.get(e.el.id) || [];
      e.node._isContainer = isContainer(e.el, childList.length > 0);
      childList.forEach(measure);
      if (!e.node.w || !e.node.h || e.node._isContainer) {
        if (e.node._isContainer) {
          const co = contentOrigin(e.el, (e.node._titleH = compositeTitleH(e.el), e.node));
          let maxX = 0, maxY = 0;
          for (const c of childList) { maxX = Math.max(maxX, c.node.x + c.node.w); maxY = Math.max(maxY, c.node.y + c.node.h); }
          const needW = Math.max(C_MINW, co.dx + maxX + C_PAD);
          const needH = Math.max(C_MINH, co.dy + maxY + C_PAD);
          e.node.w = Math.max(e.node.w || 0, needW);
          e.node.h = Math.max(e.node.h || 0, needH);
        } else {
          const s = computeSize(e.el); if (!e.node.w) e.node.w = s.w; if (!e.node.h) e.node.h = s.h;
        }
      }
    }
    roots.forEach(measure);

    // FK column names per table (for ER rendering)
    const fkCols = new Map();
    for (const r of model.relationships) {
      if (r.type === "fk" && r.fkColumn) {
        if (!fkCols.has(r.sourceId)) fkCols.set(r.sourceId, new Set());
        fkCols.get(r.sourceId).add(r.fkColumn);
      }
    }

    // draw (pre-order), accumulating absolute positions
    const absById = new Map();
    const containers = [];
    function draw(e, ox, oy, parentG) {
      const ax = ox + e.node.x, ay = oy + e.node.y;
      absById.set(e.el.id, { x: ax, y: ay, w: e.node.w, h: e.node.h });
      const g = el2("g", { class: "uml-node", "data-id": e.el.id, transform: `translate(${e.node.x},${e.node.y})` });
      if (e.el.type === "dbtable") e.node._fkCols = fkCols.get(e.el.id);
      drawShape(g, e.el, e.node);
      parentG.appendChild(g);
      const childList = kids.get(e.el.id) || [];
      if (childList.length || e.node._isContainer) {
        const co = contentOrigin(e.el, e.node);
        containers.push({ id: e.el.id, ax, ay, w: e.node.w, h: e.node.h, cx: ax + co.dx, cy: ay + co.dy });
        const cg = el2("g", { transform: `translate(${co.dx},${co.dy})` });
        g.appendChild(cg);
        for (const c of childList) draw(c, ax + co.dx, ay + co.dy, cg);
      }
    }
    roots.forEach((e) => draw(e, 0, 0, nodeLayer));

    // IBD boundary frame: the enclosing block, drawn behind its parts. Computed
    // from the part geometry (before ports) and registered in absById so that
    // block-owned ports snap to the boundary just like part-owned ports do.
    if (diagram.type === "ibd" && diagram.blockId) {
      const b = Model.elementById(model, diagram.blockId);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [, a] of absById) { minX = Math.min(minX, a.x); minY = Math.min(minY, a.y); maxX = Math.max(maxX, a.x + a.w); maxY = Math.max(maxY, a.y + a.h); }
      if (!isFinite(minX)) { minX = 40; minY = 48; maxX = 260; maxY = 170; }
      const pad = 28, fx = minX - pad, fy = minY - pad, fw = (maxX - minX) + pad * 2, fh = (maxY - minY) + pad * 2;
      absById.set(diagram.blockId, { x: fx, y: fy, w: fw, h: fh });
      const fg = el2("g", { class: "ibd-frame", "data-id": diagram.blockId });
      fg.appendChild(el2("rect", { x: fx, y: fy, width: fw, height: fh, fill: "none", stroke: PAL.edge, "stroke-width": 1.4, rx: 4 }));
      const label = "«block» " + ((b && b.name) || "");
      const tabW = tw(label, F_STEREO) + 18;
      fg.appendChild(el2("rect", { x: fx, y: fy - 20, width: tabW, height: 20, fill: PAL.canvas, stroke: PAL.edge, "stroke-width": 1.4 }));
      fg.appendChild(text(fx + 9, fy - 6, label, { "font-style": "italic", "font-size": 12, fill: PAL.edgeText }));
      nodeLayer.insertBefore(fg, nodeLayer.firstChild);
    }

    // ports: snap to owner border (part OR block boundary), else free-floating
    for (const e of ports) {
      const sz = computeSize(e.el); e.node.w = sz.w; e.node.h = sz.h;
      const owner = e.el.ownerId && absById.get(e.el.ownerId);
      let cx, cy, edge;
      if (owner) { const sp = snapPort(owner, e.node.x + sz.w / 2, e.node.y + sz.h / 2); cx = sp.x; cy = sp.y; edge = sp.edge; }
      else { cx = e.node.x + sz.w / 2; cy = e.node.y + sz.h / 2; edge = "right"; }
      nodeLayer.appendChild(drawPort(e.el, cx, cy, edge));
      absById.set(e.el.id, { x: cx - sz.w / 2, y: cy - sz.h / 2, w: sz.w, h: sz.h });
    }

    // edges (absolute)
    const hidden = new Set(diagram.hidden || []);
    for (const rel of model.relationships) {
      if (hidden.has(rel.id)) continue;
      if (!absById.has(rel.sourceId) || !absById.has(rel.targetId)) continue;
      const g = drawEdge(rel, absById);
      if (g) edgeLayer.appendChild(g);
    }

    const layers = { root, edgeLayer, nodeLayer, overlay, absById, containers };
    if (opts.selection) drawSelection(layers, opts.selection);
    return layers;
  }

  function drawSelection(layers, sel) {
    if (sel.kind === "element") {
      const a = layers.absById.get(sel.id); if (!a) return;
      const g = layers.nodeLayer.querySelector(`.uml-node[data-id="${cssEsc(sel.id)}"]`);
      if (g) g.classList.add("selected");
      const hs = el2("g", { class: "handles" });
      [["nw", a.x, a.y], ["ne", a.x + a.w, a.y], ["sw", a.x, a.y + a.h], ["se", a.x + a.w, a.y + a.h]]
        .forEach(([h, x, y]) => hs.appendChild(el2("rect", { x: x - 4, y: y - 4, width: 8, height: 8, class: "handle", "data-h": h, fill: "#5b9bff", stroke: "#fff" })));
      layers.overlay.appendChild(hs);
    } else if (sel.kind === "relationship") {
      const g = layers.edgeLayer.querySelector(`.edge[data-id="${cssEsc(sel.id)}"] .edge-line`);
      if (g) { g.setAttribute("stroke", "#5b9bff"); g.setAttribute("stroke-width", "2.5"); }
    }
  }

  // ---- dom helpers -------------------------------------------------------
  function el2(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function text(x, y, s, attrs) { const t = el2("text", { x, y, ...attrs }); t.textContent = s; return t; }
  function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function defs() {
    const d = el2("defs", {});
    const p = el2("pattern", { id: "grid", width: 26, height: 26, patternUnits: "userSpaceOnUse" });
    p.appendChild(el2("path", { d: "M 26 0 L 0 0 0 26", fill: "none", stroke: "#182033", "stroke-width": 1 }));
    d.appendChild(p);
    return d;
  }

  global.Renderer = { render, computeSize };
})(window);
