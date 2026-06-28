/* ============================================================================
 * xmi-import.js — Convert the XmiParser output (id->element Map) into the
 * editor's internal model, then auto-lay-out one diagram per package so an
 * imported file is immediately viewable and editable.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const METATYPE_TO_TYPE = {
    Class: "class", Interface: "interface", Enumeration: "enumeration",
    DataType: "datatype", PrimitiveType: "primitive", Component: "component",
    Actor: "actor", UseCase: "usecase", Signal: "class",
  };

  function fromXmi(text) {
    const parsed = XmiParser.parse(text);
    const model = Model.newModel(parsed.name || "Imported Model");

    // --- elements ---
    for (const e of parsed.elements.values()) {
      if (e.kind === "package") {
        const pkg = Model.newElement("package", e.name);
        pkg.id = e.id; pkg.ownerId = e.parent || null;
        model.elements.push(pkg);
      } else if (e.kind === "classifier") {
        const type = pickType(e);
        const el = Model.newElement(type, e.name);
        el.id = e.id;
        el.ownerId = e.parent || null;
        el.isAbstract = !!e.isAbstract;
        el.stereotypes = (e.stereotypes || []).slice();
        el.literals = (e.literals || []).slice();
        el.tags = Object.assign({}, e.tags);
        el.attributes = (e.attributes || []).map((a) => ({
          id: Model.uid("attr"), name: a.name || "", type: a.typeName || "",
          visibility: a.visibility || "private",
          multiplicity: mult(a.lower, a.upper), defaultValue: a.defaultValue || "",
          isStatic: !!a.isStatic, isDerived: !!a.isDerived,
        }));
        el.operations = (e.operations || []).map((o) => ({
          id: Model.uid("op"), name: o.name || "", returnType: o.returnName || "",
          visibility: o.visibility || "public", isStatic: !!o.isStatic, isAbstract: !!o.isAbstract,
          params: (o.params || []).map((p) => ({ name: p.name || "", type: p.typeName || "", direction: p.direction || "in" })),
        }));
        model.elements.push(el);
      }
    }

    // --- relationships (parser type names already match our catalog) ---
    for (const r of parsed.relationships) {
      if (!Model.elementById(model, r.source) || !Model.elementById(model, r.target)) continue;
      const rel = Model.newRelationship(r.type in Model.RELATIONSHIPS ? r.type : "association", r.source, r.target);
      rel.id = r.id || rel.id;
      rel.name = r.name || "";
      rel.sourceMult = r.sourceMult || ""; rel.targetMult = r.targetMult || "";
      rel.sourceRole = r.sourceLabel || ""; rel.targetRole = r.targetLabel || "";
      model.relationships.push(rel);
    }

    // --- diagrams: one per package containing classifiers, plus an overview ---
    const classifiers = model.elements.filter((e) => isClassifier(e));
    const sysml = classifiers.some((c) => ["block", "requirement", "valueType", "constraint", "interfaceBlock"].includes(c.type));
    makeDiagram(model, "Overview", sysml ? "bdd" : "class", classifiers.map((c) => c.id));

    for (const pkg of model.elements.filter((e) => e.type === "package")) {
      const ids = classifiers.filter((c) => c.ownerId === pkg.id).map((c) => c.id);
      if (ids.length) makeDiagram(model, pkg.name, sysml ? "bdd" : "class", ids);
    }
    return model;
  }

  function makeDiagram(model, name, type, ids) {
    const d = Model.newDiagram(type, name);
    const nodes = ids.map((id) => {
      const el = Model.elementById(model, id);
      const sz = Renderer.computeSize(el);
      return { id, w: sz.w, h: sz.h };
    });
    const edges = model.relationships.filter((r) => ids.includes(r.sourceId) && ids.includes(r.targetId));
    const pos = Layout.layout(nodes, edges.map((r) => ({ source: r.sourceId, target: r.targetId, type: r.type })), { seed: hash(name) });
    d.nodes = nodes.map((n) => {
      const p = pos.get(n.id) || { x: 60, y: 60 };
      return { elementId: n.id, x: Math.round(p.x), y: Math.round(p.y), w: n.w, h: n.h };
    });
    model.diagrams.push(d);
    return d;
  }

  function pickType(e) {
    const st = (e.stereotypes || []).map((s) => s.toLowerCase());
    if (st.includes("block")) return "block";
    if (st.includes("requirement")) return "requirement";
    if (st.includes("valuetype")) return "valueType";
    if (st.includes("constraint")) return "constraint";
    if (st.includes("interfaceblock")) return "interfaceBlock";
    return METATYPE_TO_TYPE[e.metatype] || "class";
  }
  function isClassifier(e) {
    return e.type !== "package" && e.type !== "note";
  }
  function mult(lo, hi) {
    if (lo == null && hi == null) return "";
    const h = hi === "-1" ? "*" : (hi == null ? "1" : hi);
    const l = lo == null ? "0" : lo;
    return l === h ? l : l + ".." + h;
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) || 7; }

  global.XmiImport = { fromXmi };
})(window);
