/* ============================================================================
 * model.js — The in-memory project model plus the UML/SysML type catalog.
 *
 * Model shape (also the JSON persisted to the server):
 *   model = { name, elements:[Element], relationships:[Relationship], diagrams:[Diagram] }
 *   Element        = { id, type, name, stereotypes[], isAbstract,
 *                      attributes[], operations[], literals[], tags{}, ownerId }
 *   Relationship   = { id, type, sourceId, targetId, name,
 *                      sourceMult, targetMult, sourceRole, targetRole, label }
 *   Diagram        = { id, type, name, nodes:[{elementId,x,y,w,h}], hidden:[relId] }
 *
 * The catalog (ELEMENTS / RELATIONSHIPS / DIAGRAMS) is the single source of
 * truth for what each diagram type offers in its palette and how things draw.
 * ==========================================================================*/
(function (global) {
  "use strict";

  let _seq = 0;
  function uid(prefix) {
    _seq++;
    return (prefix || "el") + "_" +
      Date.now().toString(36) + "_" + _seq.toString(36) +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  // ---- element type catalog ---------------------------------------------
  // shape: how the renderer draws it. compartments: which feature lists show.
  const ELEMENTS = {
    // --- UML structural ---
    class:        { label: "Class",         shape: "classifier", compartments: ["attributes", "operations"], stereotype: null },
    interface:    { label: "Interface",     shape: "classifier", compartments: ["attributes", "operations"], stereotype: "interface" },
    enumeration:  { label: "Enumeration",   shape: "classifier", compartments: ["literals"], stereotype: "enumeration" },
    datatype:     { label: "Data Type",     shape: "classifier", compartments: ["attributes"], stereotype: "dataType" },
    primitive:    { label: "Primitive",     shape: "classifier", compartments: [], stereotype: "primitive" },
    component:    { label: "Component",     shape: "component",  compartments: ["operations"], stereotype: "component" },
    package:      { label: "Package",       shape: "package",    compartments: [], stereotype: null },
    instance:     { label: "Instance",      shape: "classifier", compartments: ["attributes"], stereotype: null, underline: true },
    // --- SysML ---
    block:        { label: "Block",         shape: "classifier", compartments: ["attributes", "operations"], stereotype: "block" },
    valueType:    { label: "Value Type",    shape: "classifier", compartments: ["attributes"], stereotype: "valueType" },
    constraint:   { label: "Constraint",    shape: "classifier", compartments: ["attributes"], stereotype: "constraint" },
    interfaceBlock:{ label: "Interface Block", shape: "classifier", compartments: ["attributes", "operations"], stereotype: "interfaceBlock" },
    part:         { label: "Part",          shape: "part",       compartments: ["attributes"], stereotype: null },
    port:         { label: "Port",          shape: "port",       compartments: [], stereotype: null },
    requirement:  { label: "Requirement",   shape: "requirement", compartments: [], stereotype: "requirement", tags: ["id", "text"] },
    // --- UML behavioral ---
    actor:        { label: "Actor",         shape: "actor",      compartments: [] },
    usecase:      { label: "Use Case",      shape: "usecase",    compartments: [] },
    state:        { label: "State",         shape: "state",      compartments: [] },
    composite:    { label: "Composite State", shape: "state",    compartments: [], container: true },
    initial:      { label: "Initial",       shape: "initial",    compartments: [], fixedSize: [22, 22] },
    final:        { label: "Final",         shape: "final",      compartments: [], fixedSize: [26, 26] },
    choice:       { label: "Choice",        shape: "choice",     compartments: [], fixedSize: [30, 30] },
    forkjoin:     { label: "Fork / Join",   shape: "forkjoin",   compartments: [], fixedSize: [90, 10] },
    junction:     { label: "Junction",      shape: "junction",   compartments: [], fixedSize: [18, 18] },
    history:      { label: "History",       shape: "history",    compartments: [], fixedSize: [24, 24] },
    // --- interaction (sequence) ---
    lifeline:     { label: "Lifeline",      shape: "lifeline",   compartments: [] },
    note:         { label: "Note",          shape: "note",       compartments: [] },
  };

  // ---- relationship type catalog ----------------------------------------
  // line: solid|dashed. sourceEnd/targetEnd: marker glyph for the renderer.
  const RELATIONSHIPS = {
    association:   { label: "Association",     line: "solid",  targetEnd: "none" },
    directed:      { label: "Directed Assoc.", line: "solid",  targetEnd: "open" },
    aggregation:   { label: "Aggregation",     line: "solid",  sourceEnd: "diamondHollow" },
    composition:   { label: "Composition",     line: "solid",  sourceEnd: "diamondFilled" },
    generalization:{ label: "Generalization",  line: "solid",  targetEnd: "triangleHollow" },
    realization:   { label: "Realization",     line: "dashed", targetEnd: "triangleHollow" },
    dependency:    { label: "Dependency",      line: "dashed", targetEnd: "open" },
    usage:         { label: "Usage",           line: "dashed", targetEnd: "open", keyword: "use" },
    include:       { label: "Include",         line: "dashed", targetEnd: "open", keyword: "include" },
    extend:        { label: "Extend",          line: "dashed", targetEnd: "open", keyword: "extend" },
    transition:    { label: "Transition",      line: "solid",  targetEnd: "open" },
    connector:     { label: "Connector",       line: "solid",  targetEnd: "none" },
    itemflow:      { label: "Item Flow",       line: "solid",  targetEnd: "open", keyword: "flow" },
    satisfy:       { label: "Satisfy",         line: "dashed", targetEnd: "triangleHollow", keyword: "satisfy" },
    derive:        { label: "Derive Reqt",     line: "dashed", targetEnd: "triangleHollow", keyword: "deriveReqt" },
    refine:        { label: "Refine",          line: "dashed", targetEnd: "triangleHollow", keyword: "refine" },
    anchor:        { label: "Anchor (note)",   line: "dashed", targetEnd: "none" },
    // --- sequence messages (rendered by the sequence renderer) ---
    msgSync:       { label: "Sync Message",    msg: true, line: "solid",  targetEnd: "triangleFilled" },
    msgAsync:      { label: "Async Message",   msg: true, line: "solid",  targetEnd: "open" },
    msgReply:      { label: "Reply",           msg: true, line: "dashed", targetEnd: "open" },
    msgCreate:     { label: "Create Message",  msg: true, line: "dashed", targetEnd: "open", keyword: "create" },
    msgDestroy:    { label: "Destroy Message", msg: true, line: "solid",  targetEnd: "open", destroy: true },
  };

  // ---- diagram type catalog (palettes) ----------------------------------
  const DIAGRAMS = {
    class: {
      label: "Class Diagram", abbr: "class",
      elements: ["class", "interface", "enumeration", "datatype", "primitive", "package", "note"],
      relationships: ["association", "directed", "aggregation", "composition", "generalization", "realization", "dependency", "usage", "anchor"],
    },
    package: {
      label: "Package Diagram", abbr: "pkg",
      elements: ["package", "class", "note"],
      relationships: ["dependency", "usage", "anchor"],
    },
    component: {
      label: "Component Diagram", abbr: "cmp",
      elements: ["component", "interface", "port", "note"],
      relationships: ["dependency", "realization", "usage", "association", "anchor"],
    },
    bdd: {
      label: "Block Definition (BDD)", abbr: "bdd",
      elements: ["block", "valueType", "constraint", "interfaceBlock", "enumeration", "package", "note"],
      relationships: ["composition", "aggregation", "generalization", "association", "directed", "dependency", "anchor"],
    },
    ibd: {
      label: "Internal Block (IBD)", abbr: "ibd",
      elements: ["part", "port", "constraint", "note"],
      relationships: ["connector", "itemflow", "anchor"],
    },
    requirement: {
      label: "Requirement Diagram", abbr: "req",
      elements: ["requirement", "block", "note"],
      relationships: ["derive", "satisfy", "refine", "dependency", "anchor"],
    },
    usecase: {
      label: "Use Case Diagram", abbr: "uc",
      elements: ["actor", "usecase", "package", "note"],
      relationships: ["association", "include", "extend", "generalization", "dependency", "anchor"],
    },
    state: {
      label: "State Machine", abbr: "stm",
      elements: ["state", "composite", "initial", "final", "choice", "forkjoin", "junction", "history", "note"],
      relationships: ["transition", "anchor"],
    },
    sequence: {
      label: "Sequence Diagram", abbr: "seq",
      elements: ["lifeline", "note"],
      relationships: ["msgSync", "msgAsync", "msgReply", "msgCreate", "msgDestroy"],
    },
  };

  const VISIBILITIES = ["public", "private", "protected", "package"];

  // ---- table/view catalog -----------------------------------------------
  const TABLES = {
    element:     { label: "Element Table" },
    requirement: { label: "Requirements Table" },
    interface:   { label: "Interface Table" },
    matrix:      { label: "Dependency Matrix" },
  };

  // ---- factories ---------------------------------------------------------
  function newModel(name) {
    return { name: name || "Model", elements: [], relationships: [], diagrams: [], tables: [] };
  }
  function newTable(kind, name) {
    const t = { id: uid("tbl"), kind: "element", name: name || (TABLES[kind] || {}).label || "Table" };
    if (kind === "element") { t.elementType = "all"; t.columns = ["name", "type", "stereotypes", "attributes", "operations"]; }
    else if (kind === "requirement") { t.elementType = "requirement"; t.columns = ["tag:id", "name", "tag:text", "rel:satisfy:in", "rel:derive:in"]; }
    else if (kind === "interface") { t.elementType = "interface"; t.columns = ["name", "operations", "attributes", "rel:realization:in"]; }
    else if (kind === "matrix") { t.kind = "matrix"; t.rowType = "all"; t.colType = "all"; t.relType = "dependency"; }
    return t;
  }
  function newElement(type, name) {
    const spec = ELEMENTS[type] || ELEMENTS.class;
    // "composite" is a convenience palette entry — it is really a State that
    // starts out marked as a container.
    const composite = type === "composite";
    const actualType = composite ? "state" : type;
    const el = {
      id: uid(actualType), type: actualType,
      name: name || (composite ? "CompositeState" : spec.label),
      stereotypes: [], isAbstract: false,
      attributes: [], operations: [], literals: [],
      tags: {}, ownerId: null,
    };
    if (spec.tags) spec.tags.forEach((t) => (el.tags[t] = ""));
    if (actualType === "state") {
      el.entry = ""; el.exit = ""; el.doActivity = "";
      el.regions = 1; el.isComposite = composite;
    }
    if (actualType === "history") el.deep = false;
    if (actualType === "lifeline") el.represents = "";
    return el;
  }
  function newAttribute(name) {
    return { id: uid("attr"), name: name || "attribute", type: "", visibility: "private",
      multiplicity: "", defaultValue: "", isStatic: false, isDerived: false };
  }
  function newOperation(name) {
    return { id: uid("op"), name: name || "operation", returnType: "", visibility: "public",
      isStatic: false, isAbstract: false, params: [] };
  }
  function newRelationship(type, sourceId, targetId) {
    const r = { id: uid("rel"), type, sourceId, targetId, name: "",
      sourceMult: "", targetMult: "", sourceRole: "", targetRole: "", label: "" };
    if (type === "transition") { r.trigger = ""; r.guard = ""; r.effect = ""; }
    if (RELATIONSHIPS[type] && RELATIONSHIPS[type].msg) { r.y = 0; r.args = ""; r.returnValue = ""; }
    return r;
  }
  // UML transition label: "trigger [guard] / effect"
  function transitionLabel(r) {
    let s = r.trigger || "";
    if (r.guard) s += " [" + r.guard + "]";
    if (r.effect) s += " / " + r.effect;
    return s.trim() || r.name || "";
  }
  // sequence message label: "ret = name(args)"
  function messageLabel(r) {
    let s = (r.name || "");
    if (r.type === "msgReply") { return s || (r.returnValue ? r.returnValue : "return"); }
    s += "(" + (r.args || "") + ")";
    if (r.returnValue) s = r.returnValue + " = " + s;
    return s;
  }
  function newDiagram(type, name) {
    const spec = DIAGRAMS[type] || DIAGRAMS.class;
    return { id: uid("dgm"), type, name: name || spec.label, nodes: [], hidden: [] };
  }

  // ---- helpers -----------------------------------------------------------
  function elementById(model, id) { return model.elements.find((e) => e.id === id); }
  function relsTouching(model, id) {
    return model.relationships.filter((r) => r.sourceId === id || r.targetId === id);
  }
  function removeElement(model, id) {
    model.elements = model.elements.filter((e) => e.id !== id);
    model.relationships = model.relationships.filter((r) => r.sourceId !== id && r.targetId !== id);
    for (const d of model.diagrams) d.nodes = d.nodes.filter((n) => n.elementId !== id);
  }
  function removeRelationship(model, id) {
    model.relationships = model.relationships.filter((r) => r.id !== id);
  }
  function stereoText(el) {
    const list = el.stereotypes && el.stereotypes.length
      ? el.stereotypes
      : (ELEMENTS[el.type] && ELEMENTS[el.type].stereotype ? [ELEMENTS[el.type].stereotype] : []);
    return list.length ? "«" + list.join(", ") + "»" : null;
  }

  global.Model = {
    uid, ELEMENTS, RELATIONSHIPS, DIAGRAMS, VISIBILITIES, TABLES,
    newModel, newElement, newAttribute, newOperation, newRelationship, newDiagram, newTable,
    elementById, relsTouching, removeElement, removeRelationship, stereoText, transitionLabel, messageLabel,
  };
})(window);
