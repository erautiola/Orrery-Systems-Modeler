/* ============================================================================
 * editor.js — Canvas interaction: pan/zoom, create elements & relationships,
 * select, move, resize, delete. Operates on the current model + diagram and
 * re-renders via Renderer. Emits onSelect / onChange / onView callbacks.
 *
 * Tools:  { mode:'select' } | { mode:'element', type } | { mode:'rel', type }
 * ==========================================================================*/
(function (global) {
  "use strict";

  function create(svg, cb) {
    const state = {
      model: null, diagram: null,
      tool: { mode: "select" },
      view: { x: 60, y: 60, scale: 1 },
      selection: null,
      drag: null,        // {type:'pan'|'move'|'resize'|'link', ...}
    };
    cb = cb || {};

    // -------------------------------------------------- rendering
    function isSeq() { return state.diagram && state.diagram.type === "sequence"; }
    function isTiming() { return state.diagram && state.diagram.type === "timing"; }
    function render() {
      const R = isSeq() ? SeqRenderer : (isTiming() ? TimeRenderer : Renderer);
      state.layers = R.render(svg, state.model, state.diagram, { selection: state.selection });
      applyView();
    }
    function applyView() {
      if (state.layers) state.layers.root.setAttribute("transform", `translate(${state.view.x},${state.view.y}) scale(${state.view.scale})`);
      if (cb.onView) cb.onView(state.view);
    }
    function toWorld(clientX, clientY) {
      const r = svg.getBoundingClientRect();
      return { x: (clientX - r.left - state.view.x) / state.view.scale,
               y: (clientY - r.top - state.view.y) / state.view.scale };
    }

    // -------------------------------------------------- selection
    function select(sel) {
      state.selection = sel;
      render();
      if (cb.onSelect) cb.onSelect(sel);
    }
    function nodeFor(id) { return state.diagram.nodes.find((n) => n.elementId === id); }

    // -------------------------------------------------- mouse down
    svg.addEventListener("mousedown", (e) => {
      const handle = e.target.closest(".handle");
      const nodeG = e.target.closest(".uml-node");
      const edgeG = e.target.closest(".edge");
      const w = toWorld(e.clientX, e.clientY);

      if (state.tool.mode === "element" && !nodeG && !handle) {
        e.preventDefault();
        createElementAt(state.tool.type, w.x, w.y);
        return;
      }
      if (handle) {
        const id = state.selection && state.selection.id;
        const n = id && nodeFor(id);
        if (n) { state.drag = { type: "resize", h: handle.getAttribute("data-h"), n, start: w, x0: n.x, y0: n.y, w0: n.w, h0: n.h }; e.preventDefault(); }
        return;
      }
      if (nodeG) {
        const id = nodeG.getAttribute("data-id");
        if (isTiming()) { select({ kind: "element", id }); e.preventDefault(); return; } // bands don't move
        if (state.tool.mode === "rel") {
          state.drag = { type: "link", sourceId: id, cur: w, msgY: w.y };
          drawTempLink(id, w);
          e.preventDefault();
          return;
        }
        const n = nodeFor(id);
        const abs = state.layers.absById.get(id) || { x: n.x, y: n.y };
        select({ kind: "element", id });
        state.drag = { type: "move", id, n, start: w, x0: n.x, y0: n.y, ax0: abs.x, ay0: abs.y };
        e.preventDefault();
        return;
      }
      if (edgeG) {
        const rid = edgeG.getAttribute("data-id");
        select({ kind: "relationship", id: rid });
        if (isSeq()) {
          const rel = state.model.relationships.find((r) => r.id === rid);
          if (rel && Model.RELATIONSHIPS[rel.type] && Model.RELATIONSHIPS[rel.type].msg)
            state.drag = { type: "msgmove", rel, start: w, y0: rel.y || 0 };
        }
        e.preventDefault();
        return;
      }
      // background → pan
      select(null);
      state.drag = { type: "pan", start: { x: e.clientX, y: e.clientY }, vx: state.view.x, vy: state.view.y };
    });

    // -------------------------------------------------- mouse move / up
    window.addEventListener("mousemove", (e) => {
      const d = state.drag; if (!d) return;
      if (d.type === "pan") {
        state.view.x = d.vx + (e.clientX - d.start.x);
        state.view.y = d.vy + (e.clientY - d.start.y);
        applyView();
      } else if (d.type === "move") {
        const w = toWorld(e.clientX, e.clientY);
        const el = Model.elementById(state.model, d.id);
        d.n.x = Math.round(d.x0 + (w.x - d.start.x));
        if (!(el && el.type === "lifeline")) d.n.y = Math.round(d.y0 + (w.y - d.start.y));
        render();
      } else if (d.type === "msgmove") {
        const w = toWorld(e.clientX, e.clientY);
        const minY = SeqRenderer.HEAD_TOP + SeqRenderer.HEAD_H + 14;
        d.rel.y = Math.max(minY, Math.round(d.y0 + (w.y - d.start.y)));
        render();
      } else if (d.type === "resize") {
        const w = toWorld(e.clientX, e.clientY);
        const dx = w.x - d.start.x, dy = w.y - d.start.y;
        let { x0, y0, w0, h0, h } = d;
        let nx = x0, ny = y0, nw = w0, nh = h0;
        if (h.includes("e")) nw = Math.max(60, w0 + dx);
        if (h.includes("s")) nh = Math.max(40, h0 + dy);
        if (h.includes("w")) { nw = Math.max(60, w0 - dx); nx = x0 + (w0 - nw); }
        if (h.includes("n")) { nh = Math.max(40, h0 - dy); ny = y0 + (h0 - nh); }
        Object.assign(d.n, { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) });
        render();
      } else if (d.type === "link") {
        d.cur = toWorld(e.clientX, e.clientY);
        const tgt = e.target.closest(".uml-node");
        updateTempLink(d, tgt ? tgt.getAttribute("data-id") : null);
      }
    });

    window.addEventListener("mouseup", (e) => {
      const d = state.drag; state.drag = null;
      if (!d) return;
      if (d.type === "move") { reparentOnDrop(d); changed(); }
      else if (d.type === "resize" || d.type === "msgmove") { changed(); }
      else if (d.type === "link") {
        const tgt = e.target.closest(".uml-node");
        const targetId = tgt && tgt.getAttribute("data-id");
        clearTempLink();
        if (targetId) createRelationship(state.tool.type, d.sourceId, targetId, d.msgY);
        else render();
      }
    });

    // wheel zoom (cursor-anchored)
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // double-click → quick rename
    svg.addEventListener("dblclick", (e) => {
      const nodeG = e.target.closest(".uml-node");
      if (!nodeG) return;
      const el = Model.elementById(state.model, nodeG.getAttribute("data-id"));
      if (!el) return;
      const name = prompt("Name:", el.name);
      if (name != null) { el.name = name; const n = nodeFor(el.id); if (n) { n.w = 0; n.h = 0; } changed(); select({ kind: "element", id: el.id }); }
    });

    // keyboard delete
    window.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && state.selection) {
        e.preventDefault(); deleteSelection();
      }
    });

    // -------------------------------------------------- operations
    function createElementAt(type, x, y) {
      const el = Model.newElement(type);
      // give a unique default name
      const base = (Model.ELEMENTS[type].label || "Element").replace(/\s|\//g, "");
      let i = 1, name = base + i;
      while (state.model.elements.some((e) => e.name === name)) name = base + (++i);
      el.name = name;
      // drop inside a container? (composite state / package)
      const C = containerAt(x, y, el.type);
      if (C) { el.ownerId = C.id; x -= C.cx; y -= C.cy; }
      else el.ownerId = null;
      state.model.elements.push(el);
      const sz = Renderer.computeSize(el);
      state.diagram.nodes.push({ elementId: el.id, x: Math.round(x), y: Math.round(y), w: sz.w, h: sz.h });
      state.tool = { mode: "select" };
      if (cb.onToolReset) cb.onToolReset();
      changed();
      select({ kind: "element", id: el.id });
    }

    // deepest container whose content area holds the point and accepts childType
    function containerAt(wx, wy, childType, excludeId) {
      const cs = (state.layers && state.layers.containers) || [];
      let best = null, bestArea = Infinity;
      for (const c of cs) {
        if (c.id === excludeId) continue;
        if (isDescendant(c.id, excludeId)) continue; // can't nest into own descendant
        if (wx < c.ax || wx > c.ax + c.w || wy < c.cy || wy > c.ay + c.h) continue;
        const parent = Model.elementById(state.model, c.id);
        if (!canNest(parent, childType)) continue;
        const area = c.w * c.h;
        if (area < bestArea) { best = c; bestArea = area; }
      }
      return best;
    }
    function canNest(parentEl, childType) {
      if (!parentEl) return false;
      if (parentEl.type === "state") return ["state", "initial", "final", "choice", "forkjoin", "junction", "history", "note"].includes(childType);
      if (parentEl.type === "partition") return ["action", "decision", "forkjoin", "initial", "final", "flowfinal", "objectNode", "note"].includes(childType);
      if (parentEl.type === "package") return childType !== "note";
      return false;
    }
    function isDescendant(maybeChildId, ancestorId) {
      if (!ancestorId) return false;
      let cur = Model.elementById(state.model, maybeChildId);
      while (cur && cur.ownerId) {
        if (cur.ownerId === ancestorId) return true;
        cur = Model.elementById(state.model, cur.ownerId);
      }
      return false;
    }

    // re-parent a moved node based on where it was dropped
    function reparentOnDrop(d) {
      const el = Model.elementById(state.model, d.id); if (!el) return;
      const newAbsX = d.ax0 + (d.n.x - d.x0), newAbsY = d.ay0 + (d.n.y - d.y0);
      const cx = newAbsX + d.n.w / 2, cy = newAbsY + d.n.h / 2;
      const C = containerAt(cx, cy, el.type, el.id);
      const newOwner = C ? C.id : null;
      if (newOwner === (el.ownerId || null)) return; // unchanged
      el.ownerId = newOwner;
      if (C) { d.n.x = Math.round(newAbsX - C.cx); d.n.y = Math.round(newAbsY - C.cy); }
      else { d.n.x = Math.round(newAbsX); d.n.y = Math.round(newAbsY); }
    }

    function createRelationship(type, sourceId, targetId, msgY) {
      const isMsg = Model.RELATIONSHIPS[type] && Model.RELATIONSHIPS[type].msg;
      if (sourceId === targetId && !isMsg) { render(); return; } // self-links only for messages
      const rel = Model.newRelationship(type, sourceId, targetId);
      if (isMsg) rel.y = Math.max(SeqRenderer.HEAD_TOP + SeqRenderer.HEAD_H + 20, Math.round(msgY || 80));
      state.model.relationships.push(rel);
      state.tool = { mode: "select" };
      if (cb.onToolReset) cb.onToolReset();
      changed();
      select({ kind: "relationship", id: rel.id });
    }

    function deleteSelection() {
      const sel = state.selection; if (!sel) return;
      if (sel.kind === "element") Model.removeElement(state.model, sel.id);
      else Model.removeRelationship(state.model, sel.id);
      select(null);
      changed();
    }

    function changed() { render(); if (cb.onChange) cb.onChange(); }

    // -------------------------------------------------- temp link line
    function drawTempLink(sourceId, w) {
      clearTempLink();
      const a = state.layers.absById.get(sourceId); if (!a) return;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "temp-link");
      line.setAttribute("x1", a.x + a.w / 2); line.setAttribute("y1", a.y + a.h / 2);
      line.setAttribute("x2", w.x); line.setAttribute("y2", w.y);
      line.setAttribute("stroke", "#5b9bff"); line.setAttribute("stroke-width", "1.6");
      line.setAttribute("stroke-dasharray", "5 4");
      state.layers.overlay.appendChild(line);
      state._temp = line;
    }
    function updateTempLink(d, hoverId) {
      if (!state._temp) drawTempLink(d.sourceId, d.cur);
      if (state._temp) { state._temp.setAttribute("x2", d.cur.x); state._temp.setAttribute("y2", d.cur.y); }
    }
    function clearTempLink() { if (state._temp) { state._temp.remove(); state._temp = null; } }

    // -------------------------------------------------- view ops
    function zoomAt(factor, cx, cy) {
      const v = state.view, ns = Math.max(0.15, Math.min(4, v.scale * factor));
      v.x = cx - (cx - v.x) * (ns / v.scale);
      v.y = cy - (cy - v.y) * (ns / v.scale);
      v.scale = ns; applyView();
    }
    function fit() {
      if (!state.layers) render();
      const abs = state.layers.absById;
      if (!abs || !abs.size) { state.view = { x: 60, y: 60, scale: 1 }; applyView(); return; }
      let m = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
      for (const a of abs.values()) {
        m.x1 = Math.min(m.x1, a.x); m.y1 = Math.min(m.y1, a.y);
        m.x2 = Math.max(m.x2, a.x + a.w); m.y2 = Math.max(m.y2, a.y + a.h);
      }
      const pad = 50, cw = svg.clientWidth, ch = svg.clientHeight;
      const w = m.x2 - m.x1 + pad * 2, h = m.y2 - m.y1 + pad * 2;
      const scale = Math.min(cw / w, ch / h, 1.5);
      state.view.scale = scale;
      state.view.x = (cw - (m.x2 + m.x1) * scale) / 2;
      state.view.y = (ch - (m.y2 + m.y1) * scale) / 2;
      applyView();
    }

    // -------------------------------------------------- public api
    return {
      setModel(m) { state.model = m; },
      setDiagram(d) { state.diagram = d; state.selection = null; render(); },
      setTool(t) { state.tool = t; svg.style.cursor = t.mode === "select" ? "grab" : "crosshair"; },
      getTool() { return state.tool; },
      render, fit,
      zoomIn: () => zoomAt(1.2, svg.clientWidth / 2, svg.clientHeight / 2),
      zoomOut: () => zoomAt(1 / 1.2, svg.clientWidth / 2, svg.clientHeight / 2),
      getView: () => state.view,
      getSelection: () => state.selection,
      reselect: (sel) => select(sel),
      refresh: () => { const s = state.selection; if (s && s.kind === "element") { const n = nodeFor(s.id); if (n) { n.w = 0; n.h = 0; } } render(); },
      deleteSelection,
      centerOn(id) {
        const a = state.layers && state.layers.absById.get(id); if (!a) return;
        const cw = svg.clientWidth, ch = svg.clientHeight, sc = state.view.scale;
        state.view.x = cw / 2 - (a.x + a.w / 2) * sc;
        state.view.y = ch / 2 - (a.y + a.h / 2) * sc;
        applyView();
      },
    };
  }

  global.Editor = { create };
})(window);
