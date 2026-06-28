/* ============================================================================
 * xmi-export.js — Serialize the internal model to OMG XMI 2.1 (UML 2.1 + a
 * SysML profile for «block»/«requirement»). Best-effort for interoperability;
 * the authoritative persistence format is the JSON model stored on the server.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const TYPE_TO_META = {
    class: "uml:Class", interface: "uml:Interface", enumeration: "uml:Enumeration",
    datatype: "uml:DataType", primitive: "uml:PrimitiveType", component: "uml:Component",
    package: "uml:Package", actor: "uml:Actor", usecase: "uml:UseCase",
    block: "uml:Class", requirement: "uml:Class", valueType: "uml:DataType",
    constraint: "uml:Class", interfaceBlock: "uml:Interface", instance: "uml:InstanceSpecification",
    state: "uml:Class", part: "uml:Property", port: "uml:Port",
  };

  function toXmi(model) {
    const esc = xmlEscape;
    const byName = new Map();
    for (const e of model.elements) if (e.name) byName.set(e.name, e.id);
    const typeRef = (name) => byName.has(name) ? ` type="${byName.get(name)}"` : "";
    const typeChild = (name, indent) =>
      (name && !byName.has(name)) ? `${indent}<type href="#${esc(name)}"/>\n` : "";

    const children = new Map(); // ownerId -> [elements]
    for (const e of model.elements) {
      const k = e.ownerId || "__root";
      if (!children.has(k)) children.set(k, []);
      children.get(k).push(e);
    }

    let out = "";
    out += `<?xml version="1.0" encoding="UTF-8"?>\n`;
    out += `<xmi:XMI xmi:version="2.1"\n`;
    out += `  xmlns:xmi="http://schema.omg.org/spec/XMI/2.1"\n`;
    out += `  xmlns:uml="http://schema.omg.org/spec/UML/2.1"\n`;
    out += `  xmlns:sysml="http://www.omg.org/spec/SysML/20120322/SysML">\n`;
    out += ` <uml:Model xmi:type="uml:Model" name="${esc(model.name || "Model")}">\n`;

    for (const e of (children.get("__root") || [])) out += elementXml(e, "  ");

    // relationships that live at model level (associations / dependencies)
    for (const r of model.relationships) out += relationshipXml(r, "  ");

    // SysML stereotype applications
    for (const e of model.elements) out += stereotypeXml(e, "  ");

    out += ` </uml:Model>\n`;
    out += `</xmi:XMI>\n`;
    return out;

    function elementXml(e, ind) {
      const meta = TYPE_TO_META[e.type] || "uml:Class";
      let s = `${ind}<packagedElement xmi:type="${meta}" xmi:id="${e.id}" name="${esc(e.name || "")}"`;
      if (e.isAbstract) s += ` isAbstract="true"`;
      const inner = [];

      for (const a of (e.attributes || [])) {
        let pa = `${ind}  <ownedAttribute xmi:type="uml:Property" xmi:id="${a.id}" name="${esc(a.name || "")}" visibility="${a.visibility || "private"}"${typeRef(a.type)}`;
        if (a.isStatic) pa += ` isStatic="true"`;
        if (a.isDerived) pa += ` isDerived="true"`;
        const kids = typeChild(a.type, ind + "    ") + multXml(a.multiplicity, ind + "    ");
        pa += kids ? `>\n${kids}${ind}  </ownedAttribute>\n` : `/>\n`;
        inner.push(pa);
      }
      for (const lit of (e.literals || [])) {
        inner.push(`${ind}  <ownedLiteral xmi:type="uml:EnumerationLiteral" xmi:id="${Model.uid("lit")}" name="${esc(lit)}"/>\n`);
      }
      for (const o of (e.operations || [])) {
        let po = `${ind}  <ownedOperation xmi:type="uml:Operation" xmi:id="${o.id}" name="${esc(o.name || "")}" visibility="${o.visibility || "public"}"`;
        po += o.isAbstract ? ` isAbstract="true"` : ``;
        const params = [];
        for (const p of (o.params || [])) {
          params.push(`${ind}    <ownedParameter xmi:type="uml:Parameter" name="${esc(p.name || "")}" direction="${p.direction || "in"}"${typeRef(p.type)}>${typeChild(p.type, "") ? "\n" + typeChild(p.type, ind + "      ") + ind + "    " : ""}</ownedParameter>\n`);
        }
        if (o.returnType) params.push(`${ind}    <ownedParameter xmi:type="uml:Parameter" name="return" direction="return"${typeRef(o.returnType)}/>\n`);
        po += params.length ? `>\n${params.join("")}${ind}  </ownedOperation>\n` : `/>\n`;
        inner.push(po);
      }
      // generalization / realization originating here
      for (const r of model.relationships) {
        if (r.sourceId !== e.id) continue;
        if (r.type === "generalization")
          inner.push(`${ind}  <generalization xmi:type="uml:Generalization" xmi:id="${r.id}" general="${r.targetId}"/>\n`);
        else if (r.type === "realization")
          inner.push(`${ind}  <interfaceRealization xmi:type="uml:InterfaceRealization" xmi:id="${r.id}" contract="${r.targetId}"/>\n`);
      }
      // nested elements (package containment)
      for (const c of (children.get(e.id) || [])) inner.push(elementXml(c, ind + "  "));

      return inner.length ? `${s}>\n${inner.join("")}${ind}</packagedElement>\n` : `${s}/>\n`;
    }

    function relationshipXml(r, ind) {
      if (["association", "directed", "aggregation", "composition", "connector", "itemflow"].includes(r.type)) {
        const aggA = "", aggB = r.type === "composition" ? ` aggregation="composite"` : (r.type === "aggregation" ? ` aggregation="shared"` : "");
        return `${ind}<packagedElement xmi:type="uml:Association" xmi:id="${r.id}" name="${esc(r.name || "")}">\n` +
          endXml(r.sourceId, r.sourceRole, r.sourceMult, aggA, r.id, ind + "  ") +
          endXml(r.targetId, r.targetRole, r.targetMult, aggB, r.id, ind + "  ") +
          `${ind}</packagedElement>\n`;
      }
      if (["dependency", "usage", "include", "extend", "derive", "satisfy", "refine"].includes(r.type)) {
        const meta = r.type === "usage" ? "uml:Usage" : "uml:Dependency";
        return `${ind}<packagedElement xmi:type="${meta}" xmi:id="${r.id}" name="${esc(r.name || Model.RELATIONSHIPS[r.type].keyword || "")}" client="${r.sourceId}" supplier="${r.targetId}"/>\n`;
      }
      return ""; // generalization/realization/transition handled elsewhere or skipped
    }
    function endXml(typeId, role, m, agg, assocId, ind) {
      let s = `${ind}<ownedEnd xmi:type="uml:Property" xmi:id="${Model.uid("end")}" name="${esc(role || "")}" type="${typeId}" association="${assocId}"${agg}`;
      const km = multXml(m, ind + "  ");
      return km ? `${s}>\n${km}${ind}</ownedEnd>\n` : `${s}/>\n`;
    }
    function multXml(m, ind) {
      if (!m) return "";
      let lo = "0", hi = "1";
      if (m === "*") { lo = "0"; hi = "*"; }
      else if (m.includes("..")) { [lo, hi] = m.split(".."); }
      else { lo = hi = m; }
      const hiVal = hi === "*" ? "*" : hi;
      return `${ind}<lowerValue xmi:type="uml:LiteralInteger" value="${lo}"/>\n` +
             `${ind}<upperValue xmi:type="uml:LiteralUnlimitedNatural" value="${hiVal}"/>\n`;
    }
    function stereotypeXml(e, ind) {
      const map = { block: "Block", requirement: "Requirement", valueType: "ValueType", constraint: "ConstraintBlock", interfaceBlock: "InterfaceBlock" };
      const st = map[e.type];
      if (!st) return "";
      let attrs = ` base_Class="${e.id}"`;
      if (e.type === "requirement") for (const k of Object.keys(e.tags || {})) attrs += ` ${k}="${esc(e.tags[k] || "")}"`;
      return `${ind}<sysml:${st}${attrs}/>\n`;
    }
  }

  function xmlEscape(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  global.XmiExport = { toXmi };
})(window);
