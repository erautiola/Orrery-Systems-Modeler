/* ============================================================================
 * layout.js — Auto-layout for diagrams whose XMI carries no diagram-interchange
 * geometry (the common case). A force-directed simulation positions nodes, with
 * a downward bias along generalization edges so inheritance reads top-to-bottom.
 * Overlaps are then removed and the result is packed toward the origin.
 * ==========================================================================*/
(function (global) {
  "use strict";

  // deterministic PRNG so re-opening a diagram is stable
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * @param nodes [{id,w,h}]  — sizes precomputed by the renderer
   * @param edges [{source,target,type}]
   * @returns Map id -> {x,y}
   */
  function layout(nodes, edges, opts = {}) {
    const rnd = mulberry32(opts.seed || 1337);
    const N = nodes.length;
    const pos = new Map();
    if (N === 0) return pos;

    // initial placement: ring + jitter, scaled by node count
    const radius = 120 + N * 24;
    nodes.forEach((n, i) => {
      const a = (i / N) * Math.PI * 2;
      pos.set(n.id, {
        x: Math.cos(a) * radius + (rnd() - 0.5) * 60,
        y: Math.sin(a) * radius + (rnd() - 0.5) * 60,
        w: n.w, h: n.h,
      });
    });

    const nodeIds = new Set(nodes.map((n) => n.id));
    const E = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

    const k = 160;                 // ideal edge length
    const iterations = 400;
    let temp = 200;                // simulated-annealing cooldown

    for (let it = 0; it < iterations; it++) {
      const disp = new Map();
      nodes.forEach((n) => disp.set(n.id, { x: 0, y: 0 }));

      // repulsion (all pairs)
      for (let i = 0; i < N; i++) {
        const pi = pos.get(nodes[i].id);
        for (let j = i + 1; j < N; j++) {
          const pj = pos.get(nodes[j].id);
          let dx = pi.x - pj.x, dy = pi.y - pj.y;
          let dist = Math.hypot(dx, dy) || 0.01;
          // account for node size so big boxes push harder
          const pad = (pi.w + pi.h + pj.w + pj.h) / 8;
          const force = (k * k) / dist + pad / dist;
          dx /= dist; dy /= dist;
          const di = disp.get(nodes[i].id), dj = disp.get(nodes[j].id);
          di.x += dx * force; di.y += dy * force;
          dj.x -= dx * force; dj.y -= dy * force;
        }
      }

      // attraction (edges)
      for (const e of E) {
        const ps = pos.get(e.source), pt = pos.get(e.target);
        let dx = ps.x - pt.x, dy = ps.y - pt.y;
        let dist = Math.hypot(dx, dy) || 0.01;
        const force = (dist * dist) / k;
        dx /= dist; dy /= dist;
        const ds = disp.get(e.source), dt = disp.get(e.target);
        ds.x -= dx * force; ds.y -= dy * force;
        dt.x += dx * force; dt.y += dy * force;

        // hierarchy bias: pull subtype below supertype for generalization/realization
        if (e.type === "generalization" || e.type === "realization") {
          ds.y += 22;  // source (subtype) downward
          dt.y -= 22;  // target (supertype) upward
        }
      }

      // gravity — pull every node toward the centroid so that disconnected
      // nodes (e.g. primitive types referenced only as attribute types) stay
      // bounded instead of drifting to infinity under pure repulsion.
      let cx = 0, cy = 0;
      for (const n of nodes) { const p = pos.get(n.id); cx += p.x; cy += p.y; }
      cx /= N; cy /= N;
      const gravity = 0.22;
      for (const n of nodes) {
        const p = pos.get(n.id), d = disp.get(n.id);
        d.x -= (p.x - cx) * gravity;
        d.y -= (p.y - cy) * gravity;
      }

      // apply with temperature cap
      for (const n of nodes) {
        const d = disp.get(n.id);
        const len = Math.hypot(d.x, d.y) || 0.01;
        const p = pos.get(n.id);
        p.x += (d.x / len) * Math.min(len, temp);
        p.y += (d.y / len) * Math.min(len, temp);
      }
      temp = Math.max(4, temp * 0.985);
    }

    removeOverlaps(nodes, pos, 28);
    normalize(pos, 60);
    return pos;
  }

  // iterative rectangle separation
  function removeOverlaps(nodes, pos, gap) {
    for (let pass = 0; pass < 60; pass++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = pos.get(nodes[i].id), b = pos.get(nodes[j].id);
          const ax1 = a.x, ay1 = a.y, ax2 = a.x + a.w, ay2 = a.y + a.h;
          const bx1 = b.x, by1 = b.y, bx2 = b.x + b.w, by2 = b.y + b.h;
          const ox = Math.min(ax2, bx2) - Math.max(ax1, bx1) + gap;
          const oy = Math.min(ay2, by2) - Math.max(ay1, by1) + gap;
          if (ox > 0 && oy > 0) {
            moved = true;
            if (ox < oy) {
              const shift = ox / 2;
              if (a.x < b.x) { a.x -= shift; b.x += shift; }
              else { a.x += shift; b.x -= shift; }
            } else {
              const shift = oy / 2;
              if (a.y < b.y) { a.y -= shift; b.y += shift; }
              else { a.y += shift; b.y -= shift; }
            }
          }
        }
      }
      if (!moved) break;
    }
  }

  // shift everything so the top-left of the bounding box is at (margin,margin)
  function normalize(pos, margin) {
    let minX = Infinity, minY = Infinity;
    for (const p of pos.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
    for (const p of pos.values()) { p.x += margin - minX; p.y += margin - minY; }
  }

  global.Layout = { layout };
})(window);
