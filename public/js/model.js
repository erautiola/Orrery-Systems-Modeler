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
(function (root) {
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
    port:         { label: "Port",          shape: "port",       compartments: [], stereotype: null, fixedSize: [16, 16] },
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
    // --- activity ---
    action:       { label: "Action",        shape: "action",     compartments: [] },
    objectNode:   { label: "Object Node",   shape: "objectnode", compartments: [] },
    decision:     { label: "Decision / Merge", shape: "choice",  compartments: [], fixedSize: [40, 30] },
    flowfinal:    { label: "Flow Final",    shape: "flowfinal",  compartments: [], fixedSize: [26, 26] },
    partition:    { label: "Partition",     shape: "partition",  compartments: [], container: true },
    // --- interaction (sequence / communication) ---
    lifeline:     { label: "Lifeline",      shape: "lifeline",   compartments: [] },
    comObject:    { label: "Object",        shape: "object",     compartments: [], underline: true },
    // --- timing ---
    timeline:     { label: "Timeline",      shape: "timeline",   compartments: [] },
    // --- data modeling (ER) ---
    dbtable:      { label: "DB Table",      shape: "dbtable",    compartments: [], stereotype: "table" },
    // --- SysML parametric ---
    constraintProp:{ label: "Constraint",   shape: "constraintprop", compartments: [], stereotype: "constraint" },
    valueProp:    { label: "Value Property", shape: "valueprop",  compartments: [] },
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
    // --- ER (crow's-foot): child(many) -> parent(one) ---
    fk:            { label: "Foreign Key",  line: "solid", sourceEnd: "crowsfoot", targetEnd: "barone" },
    // --- activity ---
    controlflow:   { label: "Control Flow", line: "solid",  targetEnd: "open" },
    objectflow:    { label: "Object Flow",  line: "dashed", targetEnd: "open" },
    // --- parametric ---
    binding:       { label: "Binding Connector", line: "solid", targetEnd: "none" },
    // --- communication: a sequence-numbered directed message along a link ---
    commMsg:       { label: "Message",      line: "solid", targetEnd: "open" },
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
    er: {
      label: "ER / Data Model", abbr: "er",
      elements: ["dbtable", "note"],
      relationships: ["fk", "anchor"],
    },
    activity: {
      label: "Activity Diagram", abbr: "act",
      elements: ["action", "decision", "forkjoin", "initial", "final", "flowfinal", "objectNode", "partition", "note"],
      relationships: ["controlflow", "objectflow", "anchor"],
    },
    parametric: {
      label: "Parametric Diagram", abbr: "par",
      elements: ["constraintProp", "valueProp", "note"],
      relationships: ["binding", "anchor"],
    },
    communication: {
      label: "Communication Diagram", abbr: "com",
      elements: ["comObject", "actor", "note"],
      relationships: ["commMsg", "anchor"],
    },
    timing: {
      label: "Timing Diagram", abbr: "tim",
      elements: ["timeline", "note"],
      relationships: [],
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
    if (actualType === "dbtable") el.columns = [];
    if (actualType === "port") { el.direction = "inout"; el.flowType = ""; el.isConjugated = false; }
    if (actualType === "timeline") {
      el.states = ["Idle", "Active"];
      el.tMax = 10;
      el.changes = [{ at: 0, state: "Idle" }, { at: 4, state: "Active" }, { at: 8, state: "Idle" }];
    }
    if (actualType === "constraintProp") { el.expression = ""; el.parameters = []; }
    if (actualType === "valueProp") { el.valueType = ""; el.value = ""; }
    return el;
  }
  function newColumn(name) {
    return { id: uid("col"), name: name || "column", dataType: "", pk: false,
      nullable: true, unique: false, defaultValue: "" };
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
    if (type === "fk") { r.fkColumn = ""; r.refColumn = ""; }
    if (type === "controlflow") { r.guard = ""; }
    if (type === "commMsg") { r.seq = ""; }
    if (type === "itemflow") { r.itemName = ""; r.itemType = ""; }
    return r;
  }
  // UML transition label: "trigger [guard] / effect"
  function transitionLabel(r) {
    let s = r.trigger || "";
    if (r.guard) s += " [" + r.guard + "]";
    if (r.effect) s += " / " + r.effect;
    return s.trim() || r.name || "";
  }
  // SysML port label: "~name : Type"
  function portLabel(el) {
    return (el.isConjugated ? "~" : "") + (el.name || "") + (el.flowType ? " : " + el.flowType : "");
  }
  // item flow label: "item : Type"
  function flowLabel(r) {
    const s = (r.itemName || "") + (r.itemType ? " : " + r.itemType : "");
    return s.trim() || r.name || "";
  }
  // communication message label: "seq: name"
  function commLabel(r) {
    const s = (r.seq ? r.seq + ": " : "") + (r.name || "");
    return s.trim();
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

  // ---- IBD from a block --------------------------------------------------
  // lower-case the first letter (a block "Wheel" -> a part named "wheel")
  function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  // Enumerate the candidate parts of a block, so a caller can offer them for
  // import into an IBD. Sources, in order:
  //   - composition / aggregation relationships whose whole end is the block
  //     (the target block types the part; targetRole names it)
  //   - `part` elements already owned by the block (part.ownerId === blockId)
  // Returns de-duped rows: { key, name, typeName, typeId, mult, source,
  //                          existingPartId? }  (key is stable & unique)
  function blockParts(model, blockId) {
    const rows = [];
    const seen = new Set();
    const push = (row) => {
      const k = (row.name || "") + " " + (row.typeId || row.typeName || "");
      if (seen.has(k)) return;
      seen.add(k); row.key = "p" + rows.length; rows.push(row);
    };
    for (const r of model.relationships || []) {
      if ((r.type !== "composition" && r.type !== "aggregation") || r.sourceId !== blockId) continue;
      const tgt = elementById(model, r.targetId);
      if (!tgt) continue;
      push({
        name: r.targetRole || lowerFirst(tgt.name) || "part",
        typeName: tgt.name || "", typeId: tgt.id,
        mult: r.targetMult || "", source: r.type, relId: r.id,
      });
    }
    for (const e of model.elements || []) {
      if (e.type !== "part" || e.ownerId !== blockId) continue;
      const at = (e.attributes && e.attributes[0]) || null;
      push({
        name: e.name || "part", typeName: (at && at.type) || e.typeName || "",
        typeId: e.typeId || null, mult: "", source: "owned", existingPartId: e.id,
      });
    }
    return rows;
  }

  // Build an IBD for `block`, importing the chosen candidate rows (from
  // blockParts). Mutates `model` (adds a diagram, and any new part elements)
  // and returns the new diagram. `chosen` is an array of blockParts rows.
  // Existing owned parts are reused; the diagram is tagged with `blockId`.
  function createIbdFromBlock(model, blockId, chosen, name) {
    const block = elementById(model, blockId);
    const d = newDiagram("ibd", name || ("IBD of " + ((block && block.name) || "Block")));
    if (block) d.blockId = block.id;
    // grid layout inside the block frame
    const FRAME_X = 40, FRAME_Y = 48, COLS = 3, GAPX = 40, GAPY = 40, CW = 150, CH = 60;
    (chosen || []).forEach((row, i) => {
      let partId = row.existingPartId;
      if (!partId) {
        const part = newElement("part");
        part.name = row.name || "part";
        part.ownerId = blockId;
        if (row.typeName) {
          const at = newAttribute("");
          at.name = ""; at.type = row.typeName; at.visibility = "public";
          part.attributes = [at];
        }
        if (row.typeId) part.typeId = row.typeId;
        model.elements.push(part);
        partId = part.id;
      }
      if (d.nodes.some((n) => n.elementId === partId)) return;
      const col = i % COLS, rowN = Math.floor(i / COLS);
      d.nodes.push({
        elementId: partId,
        x: FRAME_X + col * (CW + GAPX),
        y: FRAME_Y + rowN * (CH + GAPY),
        w: CW, h: CH,
      });
    });
    model.diagrams.push(d);
    return d;
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

  const api = {
    uid, ELEMENTS, RELATIONSHIPS, DIAGRAMS, VISIBILITIES, TABLES,
    newModel, newElement, newAttribute, newOperation, newRelationship, newDiagram, newTable, newColumn,
    elementById, relsTouching, removeElement, removeRelationship, stereoText, transitionLabel, messageLabel, commLabel,
    portLabel, flowLabel, blockParts, createIbdFromBlock,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node (tests)
  if (root) root.Model = api;                                                // browser
})(typeof window !== "undefined" ? window : null);
