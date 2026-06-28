/* ============================================================================
 * xmi-parser.js — Parse OMG XMI (XML Metadata Interchange) into an internal
 * model usable by the layout engine and renderer.
 *
 * Supports the common cases produced by Enterprise Architect, Eclipse Papyrus,
 * MagicDraw / Cameo and similar tools:
 *   - XMI 2.x with UML 2.x (xmi:type / xsi:type metaclasses)
 *   - Packages (nested), Classes, Interfaces, DataTypes, Enumerations,
 *     Components, Actors, Use Cases
 *   - Attributes (ownedAttribute), Operations (ownedOperation) + parameters
 *   - Generalizations, Associations (incl. aggregation/composition),
 *     Dependencies, Realizations, Usages
 *   - SysML stereotypes applied via «Block», «Requirement», etc. (best-effort)
 * ==========================================================================*/
(function (global) {
  "use strict";

  // ---- namespace-aware attribute helpers ---------------------------------
  // xmi:id / xmi:type / xsi:type may appear with various prefixes; match by
  // local name + namespace heuristics rather than relying on a fixed prefix.
  function nsAttr(el, local, nsHint) {
    for (const a of el.attributes) {
      if (a.localName === local) {
        if (!nsHint) return a.value;
        const ns = (a.namespaceURI || "") + "|" + (a.prefix || "");
        if (ns.toLowerCase().includes(nsHint)) return a.value;
      }
    }
    return null;
  }
  const xmiId  = (el) => nsAttr(el, "id", "xmi") || nsAttr(el, "id");
  const xmiIdref = (el) => nsAttr(el, "idref", "xmi") || nsAttr(el, "idref");
  // metaclass: xmi:type or xsi:type (namespaced "type")
  function metaType(el) {
    return el.getAttribute("xmi:type") || el.getAttribute("xsi:type") ||
           nsAttr(el, "type", "xmi") || nsAttr(el, "type", "xsi") ||
           // fall back to the element's own tag (Papyrus uses <uml:Class>)
           (el.namespaceURI && /uml|sysml/i.test(el.namespaceURI) ? "uml:" + el.localName : null);
  }
  // a plain (non-namespaced) attribute, e.g. type/general/association references
  function plain(el, name) {
    const a = el.getAttribute(name);
    return a === "" ? null : a;
  }
  const localType = (mt) => (mt || "").split(":").pop();

  // ---- entry point --------------------------------------------------------
  function parse(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error("Invalid XML: " + err.textContent.slice(0, 200));

    const model = {
      name: null,
      elements: new Map(),     // id -> element
      relationships: [],       // {id,type,source,target,...}
      roots: [],               // top-level package/element ids
      stats: {},
    };

    // 1. find all element nodes carrying an xmi:id (the model graph)
    //    and index them by id for later reference resolution.
    const byId = model.elements;

    // The root model is usually <uml:Model> or a <packagedElement> under <xmi:XMI>.
    const modelRoot = doc.querySelector("Model, *|Model") ||
                      findFirst(doc.documentElement, (e) => /Model$/.test(e.localName)) ||
                      doc.documentElement;
    model.name = modelRoot ? (plain(modelRoot, "name") || "Model") : "Model";

    // 2. recursive walk to collect ownable elements
    const pending = [];   // deferred relationship resolution
    const ownedEnds = []; // association member-ends owned by classes
    walk(modelRoot, null);

    function walk(node, parentId) {
      for (const child of node.children) {
        const tag = child.localName;
        const mt = metaType(child);
        const lt = localType(mt) || tag;

        // skip pure XMI scaffolding / documentation / extensions
        if (/^(Extension|eAnnotations|Documentation|ownedComment|body)$/i.test(tag)) continue;

        if (tag === "packagedElement" || /^(Model|Package|Class|Interface|Enumeration|DataType|PrimitiveType|Component|Actor|UseCase)$/.test(tag)) {
          handleElement(child, parentId, lt);
        } else if (tag === "ownedMember" || tag === "ownedType") {
          handleElement(child, parentId, lt);
        } else {
          // descend into structural containers we don't otherwise model
          walk(child, parentId);
        }
      }
    }

    function handleElement(el, parentId, lt) {
      const id = xmiId(el);
      const kind = classify(lt, el);

      if (kind === "package" || kind === "model") {
        const pkg = mkPackage(el, id, parentId, kind);
        byId.set(id, pkg);
        if (parentId == null) model.roots.push(id);
        // recurse into the package
        for (const child of el.children) {
          const ctag = child.localName;
          const cmt = localType(metaType(child)) || ctag;
          if (ctag === "packagedElement" || ctag === "ownedMember") {
            handleElement(child, id, cmt);
          } else if (ctag === "packageImport" || ctag === "profileApplication") {
            /* ignore */
          } else {
            // associations etc. can also live directly here
            handleElement(child, id, cmt);
          }
        }
        return;
      }

      if (kind === "relationship") {
        pending.push({ el, parentId, lt });
        return;
      }

      if (kind === "classifier") {
        const cl = mkClassifier(el, id, parentId, lt);
        byId.set(id, cl);
        if (parentId == null) model.roots.push(id);
        // generalizations declared inside the classifier
        for (const g of el.children) {
          if (g.localName === "generalization") {
            const general = plain(g, "general") || childRef(g, "general");
            if (general) model.relationships.push({
              id: xmiId(g) || id + "_gen_" + general,
              type: "generalization", source: id, target: general,
            });
          } else if (g.localName === "interfaceRealization" || g.localName === "implementation") {
            const supplier = plain(g, "contract") || plain(g, "supplier") || childRef(g, "contract");
            if (supplier) model.relationships.push({
              id: xmiId(g) || id + "_real_" + supplier,
              type: "realization", source: id, target: supplier,
            });
          }
        }
        return;
      }
      // anything else: try descending (could wrap real elements)
      walk(el, parentId);
    }

    // 3. resolve deferred relationships (associations / dependencies)
    for (const p of pending) resolveRelationship(p);

    // 4. resolve property/parameter type names now that all ids are known
    resolveTypeNames();

    // 5. apply stereotypes (SysML profile applications etc.)
    applyStereotypes(doc);

    // 6. resolve association ends declared as ownedAttributes on classes
    resolveClassOwnedEnds();

    model.stats = computeStats();
    return model;

    // ===================== element builders ==============================
    function mkPackage(el, id, parentId, kind) {
      return {
        id, kind: "package", metatype: kind === "model" ? "Model" : "Package",
        name: plain(el, "name") || (kind === "model" ? "Model" : "(package)"),
        parent: parentId, children: [], comment: getComment(el),
      };
    }

    function mkClassifier(el, id, parentId, lt) {
      const node = {
        id, kind: "classifier", metatype: lt,
        name: plain(el, "name") || "(unnamed)",
        parent: parentId,
        stereotypes: [],
        isAbstract: plain(el, "isAbstract") === "true",
        attributes: [], operations: [], literals: [],
        comment: getComment(el),
        tags: {},
      };
      for (const c of el.children) {
        const ctag = c.localName;
        if (ctag === "ownedAttribute") {
          const prop = mkProperty(c);
          // an attribute that participates in an association is a member-end,
          // not a displayed attribute — keep it aside for edge building.
          if (prop.association) {
            ownedEnds.push({ ...prop, ownerClass: id });
          } else {
            node.attributes.push(prop);
          }
        } else if (ctag === "ownedOperation") {
          node.operations.push(mkOperation(c));
        } else if (ctag === "ownedLiteral") {
          node.literals.push(plain(c, "name") || "(literal)");
        }
      }
      return node;
    }

    function mkProperty(c) {
      return {
        id: xmiId(c),
        name: plain(c, "name") || "",
        visibility: plain(c, "visibility") || "public",
        typeRef: plain(c, "type") || childRef(c, "type") || hrefName(c, "type"),
        typeName: null,
        isStatic: plain(c, "isStatic") === "true",
        isDerived: plain(c, "isDerived") === "true",
        aggregation: plain(c, "aggregation") || "none",
        association: plain(c, "association"),
        lower: multiplicity(c, "lowerValue"),
        upper: multiplicity(c, "upperValue"),
        defaultValue: defaultVal(c),
      };
    }

    function mkOperation(c) {
      const op = {
        id: xmiId(c),
        name: plain(c, "name") || "",
        visibility: plain(c, "visibility") || "public",
        isStatic: plain(c, "isStatic") === "true",
        isAbstract: plain(c, "isAbstract") === "true",
        params: [], returnRef: null, returnName: null,
      };
      for (const p of c.children) {
        if (p.localName !== "ownedParameter") continue;
        const dir = plain(p, "direction") || "in";
        const tref = plain(p, "type") || childRef(p, "type") || hrefName(p, "type");
        if (dir === "return") {
          op.returnRef = tref;
        } else {
          op.params.push({ name: plain(p, "name") || "arg", typeRef: tref, typeName: null, direction: dir });
        }
      }
      return op;
    }

    // ===================== relationships =================================
    function resolveRelationship({ el, parentId, lt }) {
      const id = xmiId(el);
      if (lt === "Association") {
        const ends = collectAssociationEnds(el);
        if (ends.length >= 2) {
          const [a, b] = ends;
          let type = "association", source = a.type, target = b.type;
          // aggregation/composition diamond sits on the "whole" end
          if (a.aggregation === "composite" || b.aggregation === "composite") {
            type = "composition";
            const whole = a.aggregation === "composite" ? b : a;
            const part  = a.aggregation === "composite" ? a : b;
            source = whole.type; target = part.type;
          } else if (a.aggregation === "shared" || b.aggregation === "shared") {
            type = "aggregation";
            const whole = a.aggregation === "shared" ? b : a;
            const part  = a.aggregation === "shared" ? a : b;
            source = whole.type; target = part.type;
          }
          if (source && target) {
            model.relationships.push({
              id, type, source, target,
              name: plain(el, "name") || "",
              sourceLabel: a.name, targetLabel: b.name,
              sourceMult: mult(a), targetMult: mult(b),
            });
          }
        }
      } else if (/Dependency|Usage|Abstraction/.test(lt)) {
        const s = plain(el, "client") || childRef(el, "client");
        const t = plain(el, "supplier") || childRef(el, "supplier");
        if (s && t) model.relationships.push({
          id, type: lt === "Usage" ? "usage" : "dependency",
          source: s, target: t, name: plain(el, "name") || "",
        });
      } else if (/Realization/.test(lt)) {
        const s = plain(el, "client") || childRef(el, "client");
        const t = plain(el, "supplier") || childRef(el, "supplier") || plain(el, "contract");
        if (s && t) model.relationships.push({ id, type: "realization", source: s, target: t });
      }
    }

    function collectAssociationEnds(el) {
      const ends = [];
      // (a) ownedEnd children directly on the association
      for (const c of el.children) {
        if (c.localName === "ownedEnd") ends.push(mkProperty(c));
      }
      // (b) if fewer than two, pull in memberEnd references that point at
      //     properties owned by the participating classes.
      if (ends.length < 2) {
        const refs = [];
        for (const c of el.children) {
          if (c.localName === "memberEnd") {
            refs.push(plain(c, "idref") || xmiIdref(c) || childRef(c, "memberEnd"));
          }
        }
        const me = plain(el, "memberEnd");
        if (me) me.split(/\s+/).forEach((r) => refs.push(r));
        for (const r of refs) {
          if (!r) continue;
          const found = ownedEnds.find((e) => e.id === r);
          if (found && !ends.some((x) => x.id === found.id)) ends.push(found);
        }
      }
      // normalise: every end exposes `type` = the classifier id it is typed by
      return ends.map((e) => ({ ...e, type: e.typeRef }));
    }

    function resolveClassOwnedEnds() {
      // group class-owned ends by association id; build edges for associations
      // that weren't already produced (no ownedEnd on the association itself).
      const seen = new Set(model.relationships.map((r) => r.id));
      const byAssoc = new Map();
      for (const e of ownedEnds) {
        if (!e.association) continue;
        if (!byAssoc.has(e.association)) byAssoc.set(e.association, []);
        byAssoc.get(e.association).push(e);
      }
      for (const [assocId, ends] of byAssoc) {
        if (seen.has(assocId)) continue;
        if (ends.length < 1) continue;
        // an end owned by a class is typed by the *other* classifier;
        // the owner is the near side.
        if (ends.length >= 2) {
          const [a, b] = ends;
          model.relationships.push({
            id: assocId, type: classifyAgg(a, b),
            source: aggSource(a, b), target: aggTarget(a, b),
            sourceLabel: b.name, targetLabel: a.name,
            sourceMult: mult(b), targetMult: mult(a),
          });
        } else {
          const a = ends[0];
          if (a.ownerClass && a.typeRef) {
            model.relationships.push({
              id: assocId, type: classifyAgg(a, {}),
              source: a.ownerClass, target: a.typeRef,
              targetLabel: a.name, targetMult: mult(a),
            });
          }
        }
        seen.add(assocId);
      }
    }
    function classifyAgg(a, b) {
      if (a.aggregation === "composite" || b.aggregation === "composite") return "composition";
      if (a.aggregation === "shared" || b.aggregation === "shared") return "aggregation";
      return "association";
    }
    function aggSource(a, b) {
      if (a.aggregation === "composite" || a.aggregation === "shared") return a.ownerClass || a.typeRef;
      if (b.aggregation === "composite" || b.aggregation === "shared") return b.ownerClass || b.typeRef;
      return a.ownerClass || a.typeRef;
    }
    function aggTarget(a, b) {
      if (a.aggregation === "composite" || a.aggregation === "shared") return a.typeRef;
      if (b.aggregation === "composite" || b.aggregation === "shared") return b.typeRef;
      return b.ownerClass || b.typeRef;
    }

    // ===================== post-processing ==============================
    function resolveTypeNames() {
      const nameOf = (ref) => {
        if (!ref) return null;
        const t = byId.get(ref);
        if (t) return t.name;
        // primitive refs like ".../PrimitiveTypes#String" keep their fragment
        return ref.includes("#") ? ref.split("#").pop() : null;
      };
      for (const el of byId.values()) {
        if (el.kind !== "classifier") continue;
        for (const a of el.attributes) a.typeName = nameOf(a.typeRef) || a.typeName;
        for (const op of el.operations) {
          op.returnName = nameOf(op.returnRef);
          for (const p of op.params) p.typeName = nameOf(p.typeRef);
        }
      }
    }

    function applyStereotypes(doc) {
      // SysML / custom profiles: stereotype applications are elements that
      // carry a base_<Metaclass> attribute pointing back at the base element.
      const all = doc.getElementsByTagName("*");
      for (const el of all) {
        let baseRef = null;
        for (const a of el.attributes) {
          if (/^base_/.test(a.localName)) { baseRef = a.value; break; }
        }
        if (!baseRef) continue;
        const target = byId.get(baseRef);
        if (!target || target.kind !== "classifier") continue;
        const stname = el.localName;
        if (!target.stereotypes.includes(stname)) target.stereotypes.push(stname);
        // capture tagged values (e.g. Requirement id/text)
        for (const a of el.attributes) {
          if (/^base_/.test(a.localName) || a.localName === "id" || a.prefix === "xmi") {
            if (a.localName === "id" && a.prefix !== "xmi") target.tags["id"] = a.value;
            continue;
          }
          target.tags[a.localName] = a.value;
        }
      }
    }

    function computeStats() {
      let pkg = 0, cls = 0, rel = model.relationships.length;
      for (const e of byId.values()) {
        if (e.kind === "package") pkg++;
        else if (e.kind === "classifier") cls++;
      }
      return { packages: pkg, classifiers: cls, relationships: rel };
    }
  }

  // ===================== small helpers ===================================
  function classify(lt, el) {
    if (lt === "Model") return "model";
    if (lt === "Package" || lt === "Profile") return "package";
    if (/Association|Dependency|Usage|Realization|Abstraction/.test(lt)) return "relationship";
    if (/Class|Interface|Enumeration|DataType|PrimitiveType|Component|Actor|UseCase|Node|Artifact|Signal|Block/.test(lt)) return "classifier";
    return "other";
  }

  function childRef(el, tag) {
    for (const c of el.children) {
      if (c.localName === tag) {
        return nsAttr(c, "idref", "xmi") || c.getAttribute("xmi:idref") || c.getAttribute("idref") || hrefFragment(c);
      }
    }
    return null;
  }
  function hrefName(el, tag) {
    for (const c of el.children) {
      if (c.localName === tag) {
        const h = c.getAttribute("href");
        if (h) return h; // resolved to fragment later
      }
    }
    const h = el.getAttribute("href");
    return h || null;
  }
  function hrefFragment(c) {
    const h = c.getAttribute("href");
    return h || null;
  }
  function multiplicity(el, tag) {
    for (const c of el.children) {
      if (c.localName === tag) {
        const v = c.getAttribute("value");
        if (v != null && v !== "") return v;
        // bound via xmi:type LiteralUnlimitedNatural with no value => 0/unbounded
        const mt = (c.getAttribute("xmi:type") || c.getAttribute("xsi:type") || "");
        if (/Unlimited/.test(mt)) return "*";
        return "0";
      }
    }
    return null;
  }
  function mult(end) {
    const lo = end.lower, hi = end.upper;
    if (lo == null && hi == null) return "";
    const h = hi === "-1" ? "*" : (hi == null ? "1" : hi);
    const l = lo == null ? "0" : lo;
    if (l === h) return l;
    return l + ".." + h;
  }
  function defaultVal(el) {
    for (const c of el.children) {
      if (c.localName === "defaultValue") {
        return c.getAttribute("value") || c.getAttribute("body") || null;
      }
    }
    return plain(el, "default");
  }
  function getComment(el) {
    for (const c of el.children) {
      if (c.localName === "ownedComment") {
        const b = c.getAttribute("body");
        if (b) return b;
        for (const bb of c.children) if (bb.localName === "body") return bb.textContent;
      }
    }
    return null;
  }
  function findFirst(root, pred) {
    const stack = [root];
    while (stack.length) {
      const n = stack.shift();
      if (n.nodeType === 1 && pred(n)) return n;
      for (const c of n.children || []) stack.push(c);
    }
    return null;
  }

  global.XmiParser = { parse };
})(window);
