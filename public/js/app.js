/* ============================================================================
 * app.js — Application controller. Wires the editor, the project REST API
 * (shared library), diagram management, the palette, and the property editor.
 * ==========================================================================*/
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const svg = $("diagram");

  const S = {
    project: null,   // { id, rev, name }
    model: null,
    diagram: null,
    table: null,
    tabs: [],        // open views: [{ kind:'diagram'|'table', id }]
    active: null,    // the currently-shown tab
    viewByTab: {},   // remembered pan/zoom per diagram tab, keyed "diagram:id"
    dirty: false,
    editor: null,
    hist: History.createHistory(100),
    restoring: false,
  };
  const CLASSIFIER_TYPES = ["class", "interface", "enumeration", "datatype", "primitive", "component",
    "block", "valueType", "constraint", "interfaceBlock", "actor", "usecase", "requirement", "instance", "part", "state"];

  // ---------------------------------------------------------------- editor
  S.editor = Editor.create(svg, {
    onSelect: (sel) => renderProps(sel),
    onChange: () => { markDirty(true); renderTree(); },
    onView: (v) => { $("zoomLabel").textContent = Math.round(v.scale * 100) + "%"; },
    onToolReset: () => highlightTool(),
  });

  // right-click a node on the canvas → context actions (e.g. Create IBD)
  svg.addEventListener("contextmenu", (e) => {
    const g = e.target.closest(".uml-node");
    if (!g || !S.model) return;
    const el = Model.elementById(S.model, g.dataset.id);
    if (!el) return;
    const items = elementMenuItems(el);
    if (items.length) { e.preventDefault(); contextMenu(e.clientX, e.clientY, items); }
  });

  // ---------------------------------------------------------------- status
  function status(msg, err) { const s = $("status"); s.textContent = msg; s.classList.toggle("err", !!err); }
  function markDirty(d, histKey) {
    S.dirty = d; $("dirtyDot").hidden = !d;
    if (d) recordHistory(histKey);
  }

  // ---------------------------------------------------------------- history
  function cloneModel() {
    try { return structuredClone(S.model); }
    catch (e) { return JSON.parse(JSON.stringify(S.model)); }
  }
  function recordHistory(key) {
    if (!S.model || S.restoring) return;
    S.hist.push(cloneModel(), key, Date.now());
    updateHistoryButtons();
  }
  function resetHistory() { if (S.model) { S.hist.reset(cloneModel()); } updateHistoryButtons(); }
  function updateHistoryButtons() {
    $("undoBtn").disabled = !(S.model && S.hist.canUndo());
    $("redoBtn").disabled = !(S.model && S.hist.canRedo());
  }
  function undo() { const s = S.hist.undo(); if (s) restoreSnapshot(s); }
  function redo() { const s = S.hist.redo(); if (s) restoreSnapshot(s); }
  function restoreSnapshot(snap) {
    S.restoring = true;
    const activeId = S.active && S.active.id, activeKind = S.active && S.active.kind;
    S.model = (function () { try { return structuredClone(snap); } catch (e) { return JSON.parse(JSON.stringify(snap)); } })();
    S.editor.setModel(S.model);
    // drop tabs whose diagram/table no longer exists after the undo/redo
    S.tabs = Tabs.prune(S.tabs, (kind, id) =>
      kind === "diagram" ? S.model.diagrams.some((d) => d.id === id) : S.model.tables.some((t) => t.id === id));
    renderDiagramList(); renderTableList(); renderTree();
    const stillActive = activeId && Tabs.has(S.tabs, { kind: activeKind, id: activeId });
    if (stillActive) setActive({ kind: activeKind, id: activeId });
    else if (S.tabs.length) setActive(S.tabs[0]);
    else loadFirstDiagram();
    S.dirty = true; $("dirtyDot").hidden = false;
    S.restoring = false;
    updateHistoryButtons();
  }

  // ============================================================ PROJECTS
  async function refreshConnection() {
    try { await Api.health(); status("Connected to model server. Open or create a project."); }
    catch { status("Cannot reach server.", true); }
  }

  async function openDialog() {
    let projects = [];
    try { projects = await Api.list(); } catch (e) { return status("List failed: " + e.message, true); }
    const body = projects.length
      ? projects.map((p) => `
        <div class="proj-row" data-id="${p.id}">
          <span>📁</span>
          <div><div><b>${esc(p.name)}</b></div>
          <div class="muted" style="font-size:11px">${p.elements} elements · ${p.diagrams} diagrams</div></div>
          <span class="meta">rev ${p.rev}<br>${fmtDate(p.updatedAt)}</span>
          <button class="trash" data-del="${p.id}" title="Delete">🗑</button>
        </div>`).join("")
      : `<div class="empty">No projects yet. Create one or import an XMI file.</div>`;
    const m = modal("Open project", body, [{ label: "Close", act: "close" }]);
    m.querySelectorAll(".proj-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.dataset.del) return;
        closeModal(); openProject(row.dataset.id);
      });
    });
    m.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this project for everyone? This cannot be undone.")) return;
      try { await Api.remove(b.dataset.del); b.closest(".proj-row").remove(); status("Project deleted."); }
      catch (err) { status("Delete failed: " + err.message, true); }
    }));
  }

  async function openProject(id) {
    try {
      const p = await Api.get(id);
      S.project = { id: p.id, rev: p.rev, name: p.name };
      S.model = normalizeModel(p.model);
      S.editor.setModel(S.model);
      S.tabs = []; S.viewByTab = {}; S.active = null;
      loadFirstDiagram();
      markDirty(false);
      resetHistory();
      updateProjectBar();
      $("canvasHint").style.display = "none";
      status(`Opened “${p.name}”.`);
      renderTree();
    } catch (e) { status("Open failed: " + e.message, true); }
  }

  async function newProject() {
    const name = prompt("New project name:", "Untitled Model");
    if (name == null) return;
    const model = Model.newModel(name || "Untitled Model");
    model.diagrams.push(Model.newDiagram("class", "Main"));
    try {
      const p = await Api.create(name || "Untitled Model", model);
      await openProject(p.id);
      status(`Created “${p.name}”.`);
    } catch (e) { status("Create failed: " + e.message, true); }
  }

  async function importXmiFile(file) {
    const text = await file.text();
    try {
      const model = XmiImport.fromXmi(text);
      const p = await Api.create(file.name.replace(/\.(xmi|xml|uml)$/i, "") || "Imported", model);
      await openProject(p.id);
      status(`Imported ${file.name}: ${model.elements.length} elements, ${model.relationships.length} relationships.`);
    } catch (e) { console.error(e); status("Import failed: " + e.message, true); }
  }

  async function loadSample() {
    try {
      const model = XmiImport.fromXmi(Samples.SYSML);
      const p = await Api.create("Satellite (sample)", model);
      await openProject(p.id);
      status("Loaded SysML sample into a new shared project.");
    } catch (e) { status("Sample failed: " + e.message, true); }
  }

  async function save() {
    if (!S.project) return status("Nothing to save — open or create a project first.", true);
    try {
      const p = await Api.save(S.project.id, { name: S.project.name, model: S.model, rev: S.project.rev });
      S.project.rev = p.rev;
      markDirty(false); updateProjectBar();
      status(`Saved “${p.name}” (rev ${p.rev}).`);
    } catch (e) {
      if (e.status === 409) {
        if (confirm(e.message + "\n\nReload the server's version now? (Your unsaved changes will be lost.)")) openProject(S.project.id);
      } else status("Save failed: " + e.message, true);
    }
  }

  function updateProjectBar() {
    $("projName").textContent = S.project ? S.project.name : "No project";
    $("revLabel").textContent = S.project ? "rev " + S.project.rev : "";
  }

  // ============================================================ EXPORT
  function exportAs(kind) {
    if (!S.model) return;
    if (kind === "xmi") download(XmiExport.toXmi(S.model), safe(S.project.name) + ".xmi", "application/xml");
    else if (kind === "json") download(JSON.stringify(S.model, null, 2), safe(S.project.name) + ".json", "application/json");
    else if (kind === "sql") download(SqlExport.toSql(S.model), safe(S.project.name) + ".sql", "text/plain");
    else if (kind === "svg") exportSvg();
  }
  function exportSvg() {
    if (!S.diagram || !S.diagram.nodes.length) return status("Diagram is empty.", true);
    let b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    for (const n of S.diagram.nodes) {
      b.x1 = Math.min(b.x1, n.x); b.y1 = Math.min(b.y1, n.y);
      b.x2 = Math.max(b.x2, n.x + (n.w || 120)); b.y2 = Math.max(b.y2, n.y + (n.h || 60));
    }
    const pad = 40, w = Math.ceil(b.x2 - b.x1 + pad * 2), h = Math.ceil(b.y2 - b.y1 + pad * 2);
    const clone = svg.cloneNode(true);
    const vp = clone.querySelector(".viewport");
    if (vp) vp.setAttribute("transform", `translate(${pad - b.x1},${pad - b.y1})`);
    clone.querySelectorAll(".handles,.temp-link").forEach((x) => x.remove());
    clone.setAttribute("width", w); clone.setAttribute("height", h); clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", w); bg.setAttribute("height", h); bg.setAttribute("fill", "#0c111b");
    clone.insertBefore(bg, clone.firstChild);
    download(new XMLSerializer().serializeToString(clone), safe(S.diagram.name) + ".svg", "image/svg+xml");
  }

  // ============================================================ DIAGRAMS
  function loadFirstDiagram() {
    if (!S.model.diagrams.length) S.model.diagrams.push(Model.newDiagram("class", "Main"));
    selectDiagram(S.model.diagrams[0]);
  }
  // open (or focus) a diagram/table in its own tab, and make it active
  function openView(kind, id) {
    S.tabs = Tabs.add(S.tabs, { kind, id });
    setActive({ kind, id });
  }
  function selectDiagram(d) { if (d) openView("diagram", d.id); }
  function selectTable(t) { if (t) openView("table", t.id); }

  // make a tab the active view (renders its diagram or table); remembers the
  // pan/zoom of the diagram we're leaving so switching back is stable
  function setActive(tab) {
    if (S.active && S.active.kind === "diagram") S.viewByTab["diagram:" + S.active.id] = S.editor.getView();
    S.active = tab ? { kind: tab.kind, id: tab.id } : null;
    if (!tab) { S.diagram = null; S.table = null; showEmptyView(); renderViewTabs(); renderDiagramList(); renderTableList(); return; }
    if (tab.kind === "diagram") {
      const d = S.model.diagrams.find((x) => x.id === tab.id);
      S.diagram = d; S.table = null;
      showDiagramView();
      S.editor.setDiagram(d);
      const saved = S.viewByTab["diagram:" + d.id];
      if (saved) S.editor.setView(saved); else S.editor.fit();
      renderPalette();
    } else {
      const t = S.model.tables.find((x) => x.id === tab.id);
      S.table = t; S.diagram = null;
      showTableView(); renderTable(t);
    }
    renderViewTabs(); renderDiagramList(); renderTableList(); renderProps(null);
  }
  // close a tab; activate a neighbour (or clear the view when none remain)
  function closeView(tab) {
    const nextTab = Tabs.same(S.active, tab) ? Tabs.next(S.tabs, tab) : S.active;
    S.tabs = Tabs.remove(S.tabs, tab);
    delete S.viewByTab[tab.kind + ":" + tab.id];
    if (Tabs.same(S.active, tab)) setActive(nextTab);
    else { renderViewTabs(); renderDiagramList(); renderTableList(); }
  }
  function renderViewTabs() {
    const bar = $("viewTabs"); bar.innerHTML = ""; bar.hidden = !S.tabs.length;
    for (const tab of S.tabs) {
      let abbr = "", name = "(gone)";
      if (tab.kind === "diagram") { const d = S.model.diagrams.find((x) => x.id === tab.id); if (d) { abbr = (Model.DIAGRAMS[d.type] || {}).abbr || d.type; name = d.name; } }
      else { const t = S.model.tables.find((x) => x.id === tab.id); if (t) { abbr = t.kind === "matrix" ? "mtx" : "tbl"; name = t.name; } }
      const el = document.createElement("div");
      el.className = "view-tab" + (Tabs.same(S.active, tab) ? " active" : "");
      el.innerHTML = `<span class="tabbr">${esc(abbr)}</span><span class="tnm">${esc(name)}</span><button class="tx" title="Close">✕</button>`;
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("tx")) { e.stopPropagation(); closeView(tab); return; }
        setActive(tab);
      });
      bar.appendChild(el);
    }
  }
  // sidebar tabs: Diagrams / Tables / Explorer
  function setSideTab(name) {
    document.querySelectorAll(".side-tab").forEach((b) => b.classList.toggle("active", b.dataset.side === name));
    document.querySelectorAll(".side-pane").forEach((p) => { p.hidden = p.dataset.pane !== name; });
  }
  function showDiagramView() { svg.style.display = ""; $("tableView").hidden = true; $("canvasHint").style.display = "none"; document.querySelector(".zoom-controls").style.display = ""; }
  function showTableView() { svg.style.display = "none"; $("tableView").hidden = false; $("canvasHint").style.display = "none"; document.querySelector(".zoom-controls").style.display = "none"; $("toolHint").classList.remove("show"); }
  function showEmptyView() { svg.style.display = "none"; $("tableView").hidden = true; document.querySelector(".zoom-controls").style.display = "none"; $("canvasHint").style.display = ""; }
  function renderDiagramList() {
    const list = $("diagramList"); list.innerHTML = "";
    for (const d of (S.model ? S.model.diagrams : [])) {
      const item = document.createElement("div");
      const isOpen = Tabs.has(S.tabs, { kind: "diagram", id: d.id });
      item.className = "diagram-item" + (S.diagram === d ? " active" : "") + (isOpen ? " open" : "");
      const spec = Model.DIAGRAMS[d.type] || {};
      item.innerHTML = `<span class="abbr">${esc(spec.abbr || d.type)}</span><span class="nm">${esc(d.name)}</span><span class="x" title="Delete">✕</span>`;
      item.addEventListener("click", (e) => {
        if (e.target.classList.contains("x")) {
          e.stopPropagation();
          if (S.model.diagrams.length <= 1) return status("Keep at least one diagram.", true);
          if (!confirm("Delete diagram “" + d.name + "”? (Elements stay in the model.)")) return;
          S.model.diagrams = S.model.diagrams.filter((x) => x !== d);
          closeView({ kind: "diagram", id: d.id });
          if (!S.tabs.length && S.model.diagrams.length) selectDiagram(S.model.diagrams[0]);
          markDirty(true); renderDiagramList();
          return;
        }
        selectDiagram(d);
      });
      list.appendChild(item);
    }
  }
  function addDiagram() {
    if (!S.model) return status("Open a project first.", true);
    const opts = Object.entries(Model.DIAGRAMS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
    const blocks = S.model.elements.filter((e) => e.type === "block");
    const body = `
      <div class="field"><label>Diagram type</label><select id="dgType">${opts}</select></div>
      <div class="field"><label>Name</label><input type="text" id="dgName" value="New Diagram"></div>
      <div id="ibdExtra" hidden></div>`;
    const m = modal("New diagram", body, [
      { label: "Cancel", act: "close" },
      { label: "Create", act: "ok", primary: true },
    ]);
    const typeSel = m.querySelector("#dgType");
    const extra = m.querySelector("#ibdExtra");
    function refreshExtra() {
      if (typeSel.value !== "ibd") { extra.hidden = true; extra.innerHTML = ""; return; }
      extra.hidden = false;
      if (!blocks.length) {
        extra.innerHTML = `<p class="muted">No blocks defined yet — create a block in a BDD first to import its parts. An empty IBD will be created.</p>`;
        return;
      }
      const bopts = blocks.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
      extra.innerHTML = `<div class="field"><label>Owning block</label><select id="ibdBlock">${bopts}</select></div><div id="ibdPicker"></div>`;
      const bsel = extra.querySelector("#ibdBlock");
      const refreshPicker = () => { extra.querySelector("#ibdPicker").innerHTML = ibdPickerBody(bsel.value); wirePicker(m); };
      bsel.addEventListener("change", refreshPicker);
      refreshPicker();
    }
    typeSel.addEventListener("change", refreshExtra);
    m.querySelector('[data-act="ok"]').addEventListener("click", () => {
      const type = typeSel.value;
      const name = m.querySelector("#dgName").value || Model.DIAGRAMS[type].label;
      if (type === "ibd") {
        const bsel = m.querySelector("#ibdBlock");
        const blockId = bsel ? bsel.value : null;
        const parts = blockId ? Model.blockParts(S.model, blockId) : [];
        const d = Model.createIbdFromBlock(S.model, blockId, chosenRows(m, parts), name);
        markDirty(true, "create-ibd"); closeModal(); selectDiagram(d);
        status(`Created “${d.name}” with ${d.nodes.length} part(s).`);
        return;
      }
      const d = Model.newDiagram(type, name);
      S.model.diagrams.push(d); markDirty(true); closeModal(); selectDiagram(d);
    });
    m.querySelector("#dgName").select();
  }

  // ---- IBD-from-block: shared part-picker + standalone flow --------------
  // checkbox list of a block's candidate parts (composition/aggregation/owned)
  function ibdPickerBody(blockId) {
    const parts = blockId ? Model.blockParts(S.model, blockId) : [];
    if (!parts.length) {
      return `<p class="muted">This block has no composed or aggregated parts yet. You can still create an empty IBD and add parts by hand.</p>`;
    }
    return `<div class="field"><label>Parts to include</label>
      <div class="picker-tools"><button type="button" class="mini" data-pick="all">All</button><button type="button" class="mini" data-pick="none">None</button></div>
      <div class="parts-list">` + parts.map((p) =>
        `<label class="parts-row"><input type="checkbox" name="parts" value="${esc(p.key)}" checked>
          <span class="pn">${esc(p.name)}${p.typeName ? " : " + esc(p.typeName) : ""}${p.mult ? " [" + esc(p.mult) + "]" : ""}</span>
          <span class="src">${esc(p.source)}</span></label>`).join("") + `</div>`;
  }
  function wirePicker(m) {
    m.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      const on = b.dataset.pick === "all";
      m.querySelectorAll('input[name="parts"]').forEach((c) => { c.checked = on; });
    }));
  }
  function chosenRows(m, parts) {
    const keys = new Set(Array.from(m.querySelectorAll('input[name="parts"]:checked')).map((c) => c.value));
    return parts.filter((p) => keys.has(p.key));
  }
  // "Create IBD from this block" — its own dialog (from the block's props / menu)
  function createIbdFromBlock(blockId) {
    const block = Model.elementById(S.model, blockId);
    if (!block || block.type !== "block") return;
    const parts = Model.blockParts(S.model, blockId);
    const body = `<div class="field"><label>New IBD name</label><input type="text" id="ibdName" value="IBD of ${esc(block.name)}"></div>` + ibdPickerBody(blockId);
    const m = modal("Create IBD from “" + block.name + "”", body, [
      { label: "Cancel", act: "close" },
      { label: "Create IBD", act: "ok", primary: true },
    ]);
    wirePicker(m);
    m.querySelector('[data-act="ok"]').addEventListener("click", () => {
      const name = m.querySelector("#ibdName").value || ("IBD of " + block.name);
      const d = Model.createIbdFromBlock(S.model, blockId, chosenRows(m, parts), name);
      markDirty(true, "create-ibd"); closeModal(); selectDiagram(d);
      status(`Created “${d.name}” with ${d.nodes.length} part(s).`);
    });
  }

  // ============================================================ PALETTE
  function renderPalette() {
    const pal = $("palette"); pal.innerHTML = "";
    if (!S.diagram) return;
    const spec = Model.DIAGRAMS[S.diagram.type]; if (!spec) return;

    pal.appendChild(toolBtn("☝ Select", { mode: "select" }));
    sec(pal, "Elements");
    for (const t of spec.elements) pal.appendChild(toolBtn(glyph(t) + " " + Model.ELEMENTS[t].label, { mode: "element", type: t }));
    sec(pal, "Relationships");
    for (const t of spec.relationships) pal.appendChild(toolBtn("⟶ " + Model.RELATIONSHIPS[t].label, { mode: "rel", type: t }));
    highlightTool();
  }
  function sec(pal, label) { const s = document.createElement("div"); s.className = "sec"; s.textContent = label; pal.appendChild(s); }
  function toolBtn(label, tool) {
    const b = document.createElement("div");
    b.className = "tool"; b.dataset.tool = JSON.stringify(tool);
    const parts = label.split(" ");
    b.innerHTML = `<span class="gl">${parts[0]}</span><span>${esc(parts.slice(1).join(" "))}</span>`;
    b.addEventListener("click", () => {
      S.editor.setTool(tool);
      highlightTool();
      const th = $("toolHint");
      if (tool.mode === "element") { th.textContent = "Click on the canvas to place a " + Model.ELEMENTS[tool.type].label; th.classList.add("show"); }
      else if (tool.mode === "rel") { th.textContent = "Drag from a source element to a target element"; th.classList.add("show"); }
      else th.classList.remove("show");
    });
    return b;
  }
  function highlightTool() {
    const cur = JSON.stringify(S.editor.getTool());
    document.querySelectorAll(".palette .tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === cur));
    if (S.editor.getTool().mode === "select") $("toolHint").classList.remove("show");
  }

  // ============================================================ TABLES
  function renderTableList() {
    const list = $("tableList"); list.innerHTML = "";
    for (const t of (S.model ? S.model.tables : [])) {
      const item = document.createElement("div");
      const isOpen = Tabs.has(S.tabs, { kind: "table", id: t.id });
      item.className = "diagram-item" + (S.table === t ? " active" : "") + (isOpen ? " open" : "");
      const abbr = t.kind === "matrix" ? "mtx" : "tbl";
      item.innerHTML = `<span class="abbr">${abbr}</span><span class="nm">${esc(t.name)}</span><span class="x" title="Delete">✕</span>`;
      item.addEventListener("click", (e) => {
        if (e.target.classList.contains("x")) {
          e.stopPropagation();
          if (!confirm("Delete table “" + t.name + "”? (Model elements are kept.)")) return;
          S.model.tables = S.model.tables.filter((x) => x !== t);
          closeView({ kind: "table", id: t.id });
          if (!S.tabs.length) loadFirstDiagram();
          markDirty(true); renderTableList();
          return;
        }
        selectTable(t);
      });
      list.appendChild(item);
    }
  }
  function addTable() {
    if (!S.model) return status("Open a project first.", true);
    const opts = Object.entries(Model.TABLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    const body = `
      <div class="field"><label>Table type</label><select id="tbType">${opts}</select></div>
      <div class="field"><label>Name</label><input type="text" id="tbName" value="New Table"></div>`;
    const m = modal("New table / matrix", body, [{ label: "Cancel", act: "close" }, { label: "Create", act: "ok", primary: true }]);
    m.querySelector('[data-act="ok"]').addEventListener("click", () => {
      const kind = m.querySelector("#tbType").value;
      const name = m.querySelector("#tbName").value || Model.TABLES[kind].label;
      const t = Model.newTable(kind, name); S.model.tables.push(t); markDirty(true); closeModal(); selectTable(t);
    });
    m.querySelector("#tbName").select();
  }

  function elementsForTable(typeFilter) {
    return S.model.elements.filter((e) => {
      if (e.type === "note") return false;
      if (!typeFilter || typeFilter === "all") return CLASSIFIER_TYPES.includes(e.type);
      if (typeFilter === "interface") return e.type === "interface" || e.type === "interfaceBlock";
      return e.type === typeFilter;
    });
  }
  function colLabel(c) {
    if (c.startsWith("tag:")) return c.slice(4);
    if (c.startsWith("rel:")) { const [, t, dir] = c.split(":"); return (Model.RELATIONSHIPS[t] ? Model.RELATIONSHIPS[t].label : t) + (dir === "in" ? " (in)" : " (out)"); }
    return c;
  }
  function cellText(el, c) {
    if (c === "name") return el.name || "";
    if (c === "type") return Model.ELEMENTS[el.type] ? Model.ELEMENTS[el.type].label : el.type;
    if (c === "stereotypes") return (el.stereotypes || []).join(", ");
    if (c === "abstract") return el.isAbstract ? "yes" : "no";
    if (c === "attributes") return (el.attributes || []).map((a) => a.name + (a.type ? ":" + a.type : "")).join("; ");
    if (c === "operations") return (el.operations || []).map((o) => o.name + "()").join("; ");
    if (c.startsWith("tag:")) return (el.tags && el.tags[c.slice(4)]) || "";
    if (c.startsWith("rel:")) { const [, t, dir] = c.split(":"); return relatedNames(el, t, dir).join(", "); }
    return "";
  }
  function relatedNames(el, relType, dir) {
    const out = [];
    for (const r of S.model.relationships) {
      if (r.type !== relType) continue;
      if (dir === "in" && r.targetId === el.id) { const s = Model.elementById(S.model, r.sourceId); if (s) out.push(s.name); }
      if (dir === "out" && r.sourceId === el.id) { const tg = Model.elementById(S.model, r.targetId); if (tg) out.push(tg.name); }
    }
    return out;
  }
  const EDITABLE = (c) => c === "name" || c === "stereotypes" || c.startsWith("tag:");

  function renderTable(t) {
    const host = $("tableView");
    if (t.kind === "matrix") return renderMatrix(t, host);
    const cols = t.columns || ["name"];
    const rows = elementsForTable(t.elementType);
    let html = `<div class="tv-bar"><h2>${esc(t.name)}</h2>`;
    html += `<span class="ctl">Type <select id="tvType"></select></span>`;
    html += `<span class="spacer"></span><button class="btn" id="tvCsv">Export CSV</button></div>`;
    html += `<table class="grid"><thead><tr>` + cols.map((c) => `<th>${esc(colLabel(c))}</th>`).join("") + `</tr></thead><tbody>`;
    for (const el of rows) {
      html += `<tr data-id="${el.id}">` + cols.map((c) =>
        EDITABLE(c)
          ? `<td><input data-edit="${esc(c)}" value="${esc(cellText(el, c))}"></td>`
          : `<td class="ro"><div class="cell">${esc(cellText(el, c))}</div></td>`
      ).join("") + `</tr>`;
    }
    html += `</tbody></table>`;
    if (!rows.length) html += `<div class="tv-empty">No matching elements. Change the type filter, or create elements on a diagram.</div>`;
    host.innerHTML = html;
    const sel = host.querySelector("#tvType");
    fillTypeSelect(sel, t.elementType);
    sel.addEventListener("change", () => { t.elementType = sel.value; markDirty(true); renderTable(t); });
    host.querySelector("#tvCsv").addEventListener("click", () => exportTableCsv(t));
    host.querySelectorAll("input[data-edit]").forEach((inp) => {
      inp.addEventListener("input", () => { applyCellEdit(inp.closest("tr").dataset.id, inp.dataset.edit, inp.value); });
    });
  }
  function applyCellEdit(id, key, val) {
    const el = Model.elementById(S.model, id); if (!el) return;
    if (key === "name") el.name = val;
    else if (key === "stereotypes") el.stereotypes = val.split(",").map((s) => s.trim()).filter(Boolean);
    else if (key.startsWith("tag:")) { el.tags = el.tags || {}; el.tags[key.slice(4)] = val; }
    markDirty(true, "cell:" + id + ":" + key); renderTree();
  }
  function fillTypeSelect(sel, current) {
    sel.innerHTML = `<option value="all">All classifiers</option>` +
      CLASSIFIER_TYPES.map((t) => `<option value="${t}"${t === current ? " selected" : ""}>${Model.ELEMENTS[t].label}</option>`).join("");
    if (current) sel.value = current;
  }

  function renderMatrix(t, host) {
    const rows = elementsForTable(t.rowType), cols = elementsForTable(t.colType);
    const relOpts = Object.entries(Model.RELATIONSHIPS).filter(([, v]) => !v.msg)
      .map(([k, v]) => `<option value="${k}"${k === t.relType ? " selected" : ""}>${v.label}</option>`).join("");
    let html = `<div class="tv-bar"><h2>${esc(t.name)}</h2>`;
    html += `<span class="ctl">Rows <select id="mxRow"></select></span>`;
    html += `<span class="ctl">Cols <select id="mxCol"></select></span>`;
    html += `<span class="ctl">Relationship <select id="mxRel">${relOpts}</select></span>`;
    html += `<span class="spacer"></span><button class="btn" id="tvCsv">Export CSV</button></div>`;
    html += `<table class="grid"><thead><tr><th class="rowhead"></th>` +
      cols.map((c) => `<th>${esc(c.name)}</th>`).join("") + `</tr></thead><tbody>`;
    for (const rEl of rows) {
      html += `<tr><td class="rowhead">${esc(rEl.name)}</td>` + cols.map((cEl) => {
        const on = S.model.relationships.some((r) => r.type === t.relType && r.sourceId === rEl.id && r.targetId === cEl.id);
        return `<td class="cellmark" data-s="${rEl.id}" data-t="${cEl.id}">${on ? '<span class="mk">●</span>' : ""}</td>`;
      }).join("") + `</tr>`;
    }
    html += `</tbody></table>`;
    if (!rows.length || !cols.length) html += `<div class="tv-empty">Pick row and column types that have elements.</div>`;
    host.innerHTML = html;
    fillTypeSelect(host.querySelector("#mxRow"), t.rowType);
    fillTypeSelect(host.querySelector("#mxCol"), t.colType);
    host.querySelector("#mxRow").addEventListener("change", (e) => { t.rowType = e.target.value; markDirty(true); renderMatrix(t, host); });
    host.querySelector("#mxCol").addEventListener("change", (e) => { t.colType = e.target.value; markDirty(true); renderMatrix(t, host); });
    host.querySelector("#mxRel").addEventListener("change", (e) => { t.relType = e.target.value; markDirty(true); renderMatrix(t, host); });
    host.querySelector("#tvCsv").addEventListener("click", () => exportMatrixCsv(t, rows, cols));
    host.querySelectorAll(".cellmark").forEach((td) => td.addEventListener("click", () => {
      toggleMatrix(t, td.dataset.s, td.dataset.t); renderMatrix(t, host);
    }));
  }
  function toggleMatrix(t, sId, tId) {
    const existing = S.model.relationships.find((r) => r.type === t.relType && r.sourceId === sId && r.targetId === tId);
    if (existing) S.model.relationships = S.model.relationships.filter((r) => r !== existing);
    else S.model.relationships.push(Model.newRelationship(t.relType, sId, tId));
    markDirty(true);
  }

  function exportTableCsv(t) {
    const cols = t.columns || ["name"];
    const rows = elementsForTable(t.elementType);
    const lines = [cols.map(colLabel).map(csv).join(",")];
    for (const el of rows) lines.push(cols.map((c) => csv(cellText(el, c))).join(","));
    download(lines.join("\r\n"), safe(t.name) + ".csv", "text/csv");
  }
  function exportMatrixCsv(t, rows, cols) {
    const lines = [["", ...cols.map((c) => c.name)].map(csv).join(",")];
    for (const rEl of rows) {
      const cells = cols.map((cEl) => S.model.relationships.some((r) => r.type === t.relType && r.sourceId === rEl.id && r.targetId === cEl.id) ? "X" : "");
      lines.push([rEl.name, ...cells].map(csv).join(","));
    }
    download(lines.join("\r\n"), safe(t.name) + ".csv", "text/csv");
  }
  function csv(v) { v = String(v == null ? "" : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  // ============================================================ PROPERTIES
  function renderProps(sel) {
    const p = $("propPanel");
    if (!sel) { p.innerHTML = '<p class="muted">Select an element or relationship to edit it.</p>'; return; }
    p.innerHTML = "";
    if (sel.kind === "element") renderElementProps(p, Model.elementById(S.model, sel.id));
    else renderRelProps(p, S.model.relationships.find((r) => r.id === sel.id));
  }

  function renderElementProps(p, el) {
    if (!el) return;
    const spec = Model.ELEMENTS[el.type];
    p.appendChild(h(`<div class="prop-title">${esc(Model.stereoText(el) || "")} ${esc(el.name)}</div>`));

    p.appendChild(textField("Name", el.name, (v) => { el.name = v; touch(true); }));
    p.appendChild(roField("Type", spec.label));
    if (spec.compartments.length || ["class", "block", "interface"].includes(el.type))
      p.appendChild(checkField("Abstract", el.isAbstract, (v) => { el.isAbstract = v; touch(true); }));
    p.appendChild(textField("Stereotypes (comma-sep)", (el.stereotypes || []).join(", "), (v) => {
      el.stereotypes = v.split(",").map((s) => s.trim()).filter(Boolean); touch(true);
    }));

    if (el.type === "block") {
      const w = h(`<div class="prop-section"><button class="btn" style="width:100%">⊞ Create IBD from this block</button></div>`);
      w.querySelector("button").addEventListener("click", () => createIbdFromBlock(el.id));
      p.appendChild(w);
    }

    if (el.type === "state") {
      p.appendChild(checkField("Composite (contains sub-states)", el.isComposite, (v) => { el.isComposite = v; touch(true); reselect(); }));
      if (el.isComposite) p.appendChild(numField("Orthogonal regions", el.regions || 1, (v) => { el.regions = Math.max(1, v | 0); touch(true); }));
      p.appendChild(textField("entry / behavior", el.entry || "", (v) => { el.entry = v; touch(true); }));
      p.appendChild(textField("exit / behavior", el.exit || "", (v) => { el.exit = v; touch(true); }));
      p.appendChild(textField("do / activity", el.doActivity || "", (v) => { el.doActivity = v; touch(true); }));
    }
    if (el.type === "history") {
      p.appendChild(checkField("Deep history (H*)", el.deep, (v) => { el.deep = v; touch(true); }));
    }
    if (el.type === "lifeline") {
      p.appendChild(textField("Represents (classifier)", el.represents || "", (v) => { el.represents = v; touch(true); }));
    }
    if (el.type === "dbtable") columnSection(p, el);
    if (el.type === "timeline") timelineSection(p, el);
    if (el.type === "port") {
      const dopts = ["in", "out", "inout"].map((x) => `<option value="${x}"${el.direction === x ? " selected" : ""}>${x}</option>`).join("");
      p.appendChild(selectField("Direction", dopts, (v) => { el.direction = v; touch(true); }));
      p.appendChild(textField("Flow type", el.flowType || "", (v) => { el.flowType = v; touch(true); }));
      p.appendChild(checkField("Conjugated (~)", el.isConjugated, (v) => { el.isConjugated = v; touch(true); }));
      const parts = S.model.elements.filter((e) => e.type === "part");
      let popts = `<option value="">(free — not on a part)</option>`;
      // on an IBD, a port may sit on the enclosing block's boundary
      if (S.diagram && S.diagram.type === "ibd" && S.diagram.blockId) {
        const blk = Model.elementById(S.model, S.diagram.blockId);
        if (blk) popts += `<option value="${blk.id}"${el.ownerId === blk.id ? " selected" : ""}>▢ ${esc(blk.name)} (boundary)</option>`;
      }
      popts += parts.map((pt) => `<option value="${pt.id}"${el.ownerId === pt.id ? " selected" : ""}>${esc(pt.name)}</option>`).join("");
      p.appendChild(selectField("On part / boundary", popts, (v) => { el.ownerId = v || null; touch(true); }));
    }
    if (el.type === "constraintProp") {
      p.appendChild(textField("Constraint expression { }", el.expression || "", (v) => { el.expression = v; touch(true); }));
      featureSection(p, "Parameters", el.parameters, () => "p", paramRow, () => el.parameters.push("p"));
    }
    if (el.type === "valueProp") {
      p.appendChild(textField("Type", el.valueType || "", (v) => { el.valueType = v; touch(true); }));
      p.appendChild(textField("Value", el.value || "", (v) => { el.value = v; touch(true); }));
    }
    if (el.type === "note") {
      p.appendChild(areaField("Text", el.name, (v) => { el.name = v; touch(true); }));
    }
    for (const k of Object.keys(el.tags || {})) {
      p.appendChild(textField(cap(k), el.tags[k], (v) => { el.tags[k] = v; touch(true); }));
    }

    if (spec.compartments.includes("literals")) featureSection(p, "Literals", el.literals, () => "literal", literalRow, () => el.literals.push("literal"));
    if (spec.compartments.includes("attributes")) attrSection(p, el);
    if (spec.compartments.includes("operations")) opSection(p, el);

    if (el.type === "block") blockStructureSections(p, el);

    // relationships summary
    const rels = Model.relsTouching(S.model, el.id);
    if (rels.length) {
      const sec = h(`<div class="prop-section"><h4>Relationships</h4></div>`);
      for (const r of rels) {
        const other = Model.elementById(S.model, r.sourceId === el.id ? r.targetId : r.sourceId);
        const dir = r.sourceId === el.id ? "→" : "←";
        sec.appendChild(h(`<div class="muted" style="font-size:12px;margin:2px 0">${esc(Model.RELATIONSHIPS[r.type].label)} ${dir} ${esc(other ? other.name : "?")}</div>`));
      }
      p.appendChild(sec);
    }
    p.appendChild(deleteBtn("Delete element", () => S.editor.deleteSelection()));
  }

  // read-only Parts / Ports summaries for a block (click a row to locate it)
  function blockStructureSections(p, el) {
    const parts = Model.blockParts(S.model, el.id);
    if (parts.length) {
      const sec = h(`<div class="prop-section"><h4>Parts</h4></div>`);
      for (const pt of parts) {
        const label = pt.name + (pt.typeName ? " : " + pt.typeName : "") + (pt.mult ? " [" + pt.mult + "]" : "");
        const targetId = pt.existingPartId || pt.typeId || null;
        const row = h(`<div class="struct-row${targetId ? " nav" : ""}"><span class="sn">${esc(label)}</span><span class="src">${esc(pt.source)}</span></div>`);
        if (targetId) row.addEventListener("click", () => navigateToRef({ kind: "element", id: targetId }));
        sec.appendChild(row);
      }
      p.appendChild(sec);
    }
    const ports = Model.blockPorts(S.model, el.id);
    if (ports.length) {
      const sec = h(`<div class="prop-section"><h4>Ports</h4></div>`);
      for (const pr of ports) {
        const portEl = Model.elementById(S.model, pr.portId);
        const label = (portEl && Model.portLabel(portEl)) || pr.name || "(unnamed)";
        const where = pr.scope === "boundary" ? "boundary" : ("on " + pr.onName);
        const row = h(`<div class="struct-row nav"><span class="sn">${esc(label)}</span><span class="src">${esc(where)}</span></div>`);
        row.addEventListener("click", () => navigateToRef({ kind: "element", id: pr.portId }));
        sec.appendChild(row);
      }
      p.appendChild(sec);
    }
  }

  function attrSection(p, el) {
    const sec = h(`<div class="prop-section"><h4>Attributes <button class="mini" title="Add">＋</button></h4></div>`);
    sec.querySelector(".mini").addEventListener("click", () => { el.attributes.push(Model.newAttribute()); touch(true); reselect(); });
    el.attributes.forEach((a, i) => {
      const row = document.createElement("div"); row.className = "feat-row";
      row.appendChild(visSelect(a.visibility, (v) => { a.visibility = v; touch(true); }));
      row.appendChild(inp("nm", a.name, "name", (v) => { a.name = v; touch(false); }));
      row.appendChild(inp("ty", a.type, "type", (v) => { a.type = v; touch(false); }));
      row.appendChild(delBtn(() => { el.attributes.splice(i, 1); touch(true); reselect(); }));
      sec.appendChild(row);
      const row2 = document.createElement("div"); row2.className = "feat-row";
      row2.appendChild(inp("ty", a.multiplicity, "mult [0..*]", (v) => { a.multiplicity = v; touch(false); }));
      row2.appendChild(inp("nm", a.defaultValue, "default", (v) => { a.defaultValue = v; touch(false); }));
      sec.appendChild(row2);
    });
    p.appendChild(sec);
  }
  function opSection(p, el) {
    const sec = h(`<div class="prop-section"><h4>Operations <button class="mini" title="Add">＋</button></h4></div>`);
    sec.querySelector(".mini").addEventListener("click", () => { el.operations.push(Model.newOperation()); touch(true); reselect(); });
    el.operations.forEach((o, i) => {
      const row = document.createElement("div"); row.className = "feat-row";
      row.appendChild(visSelect(o.visibility, (v) => { o.visibility = v; touch(true); }));
      row.appendChild(inp("nm", o.name, "name", (v) => { o.name = v; touch(false); }));
      row.appendChild(inp("ty", o.returnType, "returns", (v) => { o.returnType = v; touch(false); }));
      row.appendChild(delBtn(() => { el.operations.splice(i, 1); touch(true); reselect(); }));
      sec.appendChild(row);
      const row2 = document.createElement("div"); row2.className = "feat-row";
      const ptxt = (o.params || []).map((x) => x.name + (x.type ? ":" + x.type : "")).join(", ");
      row2.appendChild(inp("nm", ptxt, "params: a:int, b:str", (v) => {
        o.params = v.split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [n, t] = s.split(":"); return { name: (n || "").trim(), type: (t || "").trim(), direction: "in" }; });
        touch(false);
      }));
      sec.appendChild(row2);
    });
    p.appendChild(sec);
  }
  function columnSection(p, el) {
    const sec = h(`<div class="prop-section"><h4>Columns <button class="mini" title="Add">＋</button></h4></div>`);
    sec.querySelector(".mini").addEventListener("click", () => { el.columns.push(Model.newColumn()); touch(true); reselect(); });
    el.columns.forEach((c, i) => {
      const row = document.createElement("div"); row.className = "feat-row";
      row.appendChild(inp("nm", c.name, "name", (v) => { c.name = v; touch(true); }));
      row.appendChild(inp("ty", c.dataType, "TYPE", (v) => { c.dataType = v; touch(true); }));
      row.appendChild(delBtn(() => { el.columns.splice(i, 1); touch(true); reselect(); }));
      sec.appendChild(row);
      const row2 = document.createElement("div"); row2.className = "feat-row";
      row2.appendChild(miniCheck("PK", c.pk, (v) => { c.pk = v; if (v) c.nullable = false; touch(true); reselect(); }));
      row2.appendChild(miniCheck("NOT NULL", c.nullable === false, (v) => { c.nullable = !v; touch(true); }));
      row2.appendChild(miniCheck("UNIQUE", c.unique, (v) => { c.unique = v; touch(true); }));
      row2.appendChild(inp("ty", c.defaultValue, "default", (v) => { c.defaultValue = v; touch(false); }));
      sec.appendChild(row2);
    });
    p.appendChild(sec);
  }
  function timelineSection(p, el) {
    p.appendChild(numField("Time length", el.tMax || 10, (v) => { el.tMax = Math.max(1, v | 0); touch(true); }));
    // states
    const ss = h(`<div class="prop-section"><h4>States <button class="mini" title="Add">＋</button></h4></div>`);
    ss.querySelector(".mini").addEventListener("click", () => { el.states.push("state"); touch(true); reselect(); });
    el.states.forEach((s, i) => {
      const row = document.createElement("div"); row.className = "feat-row";
      row.appendChild(inp("nm", s, "state", (v) => { el.states[i] = v; touch(true); }));
      row.appendChild(delBtn(() => { el.states.splice(i, 1); touch(true); reselect(); }));
      ss.appendChild(row);
    });
    p.appendChild(ss);
    // state changes (at -> state)
    const cs = h(`<div class="prop-section"><h4>State changes <button class="mini" title="Add">＋</button></h4></div>`);
    cs.querySelector(".mini").addEventListener("click", () => { el.changes.push({ at: 0, state: el.states[0] || "" }); touch(true); reselect(); });
    el.changes.forEach((c, i) => {
      const row = document.createElement("div"); row.className = "feat-row";
      const at = document.createElement("input"); at.className = "ty"; at.value = c.at; at.placeholder = "at";
      at.addEventListener("input", () => { const n = parseFloat(at.value); if (!isNaN(n)) { c.at = n; touch(true); } });
      const sel = document.createElement("select"); sel.className = "nm";
      el.states.forEach((st) => { const o = document.createElement("option"); o.value = st; o.textContent = st; if (st === c.state) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", () => { c.state = sel.value; touch(true); });
      row.appendChild(at); row.appendChild(sel);
      row.appendChild(delBtn(() => { el.changes.splice(i, 1); touch(true); reselect(); }));
      cs.appendChild(row);
    });
    p.appendChild(cs);
  }
  function miniCheck(label, val, on) {
    const w = document.createElement("label");
    w.style.cssText = "display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);white-space:nowrap";
    const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!val;
    c.addEventListener("change", () => on(c.checked));
    w.appendChild(c); w.appendChild(document.createTextNode(label));
    return w;
  }
  function featureSection(p, title, arr, def, rowFn, add) {
    const sec = h(`<div class="prop-section"><h4>${title} <button class="mini">＋</button></h4></div>`);
    sec.querySelector(".mini").addEventListener("click", () => { add(); touch(true); reselect(); });
    arr.forEach((v, i) => sec.appendChild(rowFn(arr, i)));
    p.appendChild(sec);
  }
  function literalRow(arr, i) {
    const row = document.createElement("div"); row.className = "feat-row";
    row.appendChild(inp("nm", arr[i], "literal", (v) => { arr[i] = v; touch(false); }));
    row.appendChild(delBtn(() => { arr.splice(i, 1); touch(true); reselect(); }));
    return row;
  }
  function paramRow(arr, i) {
    const row = document.createElement("div"); row.className = "feat-row";
    row.appendChild(inp("nm", arr[i], "parameter", (v) => { arr[i] = v; touch(true); }));
    row.appendChild(delBtn(() => { arr.splice(i, 1); touch(true); reselect(); }));
    return row;
  }

  function renderRelProps(p, r) {
    if (!r) return;
    const src = Model.elementById(S.model, r.sourceId), tgt = Model.elementById(S.model, r.targetId);
    p.appendChild(h(`<div class="prop-title">${esc(Model.RELATIONSHIPS[r.type].label)}</div>`));
    p.appendChild(h(`<div class="muted" style="font-size:12px;margin-bottom:8px">${esc(src ? src.name : "?")} → ${esc(tgt ? tgt.name : "?")}</div>`));
    const opts = Object.entries(Model.RELATIONSHIPS).map(([k, v]) => `<option value="${k}"${k === r.type ? " selected" : ""}>${v.label}</option>`).join("");
    const isMsg = Model.RELATIONSHIPS[r.type] && Model.RELATIONSHIPS[r.type].msg;
    if (isMsg) {
      const mopts = Object.entries(Model.RELATIONSHIPS).filter(([, v]) => v.msg)
        .map(([k, v]) => `<option value="${k}"${k === r.type ? " selected" : ""}>${v.label}</option>`).join("");
      p.appendChild(selectField("Message kind", mopts, (v) => { r.type = v; touch(true); reselect(); }));
      p.appendChild(textField("Operation / name", r.name, (v) => { r.name = v; touch(true); }));
      p.appendChild(textField("Arguments", r.args || "", (v) => { r.args = v; touch(true); }));
      p.appendChild(textField("Return value", r.returnValue || "", (v) => { r.returnValue = v; touch(true); }));
      p.appendChild(deleteBtn("Delete message", () => S.editor.deleteSelection()));
      return;
    }
    p.appendChild(selectField("Type", opts, (v) => { r.type = v; touch(true); reselect(); }));
    if (r.type === "fk") {
      const src = Model.elementById(S.model, r.sourceId), tgt = Model.elementById(S.model, r.targetId);
      p.appendChild(h(`<div class="muted" style="font-size:12px;margin-bottom:8px">FK: ${esc(src ? src.name : "child")} → ${esc(tgt ? tgt.name : "parent")}</div>`));
      p.appendChild(textField(`FK column (in ${src ? src.name : "child"})`, r.fkColumn || "", (v) => { r.fkColumn = v; touch(true); }));
      p.appendChild(textField(`References column (in ${tgt ? tgt.name : "parent"})`, r.refColumn || "", (v) => { r.refColumn = v; touch(false); }));
      p.appendChild(deleteBtn("Delete foreign key", () => S.editor.deleteSelection()));
      return;
    }
    if (r.type === "itemflow") {
      p.appendChild(textField("Item name", r.itemName || "", (v) => { r.itemName = v; touch(true); }));
      p.appendChild(textField("Item type", r.itemType || "", (v) => { r.itemType = v; touch(true); }));
      p.appendChild(deleteBtn("Delete item flow", () => S.editor.deleteSelection()));
      return;
    }
    if (r.type === "commMsg") {
      const r2 = h(`<div class="row2"></div>`);
      r2.appendChild(textField("Sequence #", r.seq || "", (v) => { r.seq = v; touch(true); }));
      p.appendChild(r2);
      p.appendChild(textField("Message", r.name || "", (v) => { r.name = v; touch(true); }));
      p.appendChild(deleteBtn("Delete message", () => S.editor.deleteSelection()));
      return;
    }
    if (r.type === "transition") {
      p.appendChild(textField("Trigger (event)", r.trigger || "", (v) => { r.trigger = v; touch(true); }));
      p.appendChild(textField("Guard [condition]", r.guard || "", (v) => { r.guard = v; touch(true); }));
      p.appendChild(textField("Effect / behavior", r.effect || "", (v) => { r.effect = v; touch(true); }));
    } else if (r.type === "controlflow") {
      p.appendChild(textField("Guard [condition]", r.guard || "", (v) => { r.guard = v; touch(true); }));
    } else {
      p.appendChild(textField("Name / label", r.name, (v) => { r.name = v; touch(true); }));
      const r2 = h(`<div class="row2"></div>`);
      r2.appendChild(textField("Source role", r.sourceRole, (v) => { r.sourceRole = v; touch(false); }));
      r2.appendChild(textField("Target role", r.targetRole, (v) => { r.targetRole = v; touch(false); }));
      p.appendChild(r2);
      const r3 = h(`<div class="row2"></div>`);
      r3.appendChild(textField("Source mult.", r.sourceMult, (v) => { r.sourceMult = v; touch(true); }));
      r3.appendChild(textField("Target mult.", r.targetMult, (v) => { r.targetMult = v; touch(true); }));
      p.appendChild(r3);
    }
    p.appendChild(deleteBtn("Delete relationship", () => S.editor.deleteSelection()));
  }

  // ----- property helpers (commit edits) ---------------------------------
  function touch(reflow) {
    const sel = S.editor.getSelection();
    markDirty(true, "prop:" + (sel ? sel.kind + ":" + sel.id : ""));
    if (reflow) S.editor.refresh(); else S.editor.render();
  }
  function reselect() { const s = S.editor.getSelection(); renderProps(s); S.editor.render(); if (s) S.editor.reselect(s); }

  function textField(label, val, on) {
    const w = h(`<div class="field"><label>${esc(label)}</label><input type="text"></div>`);
    const i = w.querySelector("input"); i.value = val || "";
    i.addEventListener("input", () => on(i.value));
    return w;
  }
  function areaField(label, val, on) {
    const w = h(`<div class="field"><label>${esc(label)}</label><textarea rows="3"></textarea></div>`);
    const t = w.querySelector("textarea"); t.value = val || "";
    t.addEventListener("input", () => on(t.value));
    return w;
  }
  function roField(label, val) { return h(`<div class="field"><label>${esc(label)}</label><input type="text" value="${esc(val)}" disabled></div>`); }
  function numField(label, val, on) {
    const w = h(`<div class="field"><label>${esc(label)}</label><input type="text"></div>`);
    const i = w.querySelector("input"); i.value = val;
    i.addEventListener("input", () => { const n = parseInt(i.value, 10); if (!isNaN(n)) on(n); });
    return w;
  }
  function selectField(label, optsHtml, on) {
    const w = h(`<div class="field"><label>${esc(label)}</label><select>${optsHtml}</select></div>`);
    w.querySelector("select").addEventListener("change", (e) => on(e.target.value));
    return w;
  }
  function checkField(label, val, on) {
    const w = h(`<div class="field check"><input type="checkbox"><label>${esc(label)}</label></div>`);
    const c = w.querySelector("input"); c.checked = !!val;
    c.addEventListener("change", () => on(c.checked));
    return w;
  }
  function visSelect(val, on) {
    const s = document.createElement("select"); s.className = "vis";
    for (const v of Model.VISIBILITIES) { const o = document.createElement("option"); o.value = v; o.textContent = v; if (v === val) o.selected = true; s.appendChild(o); }
    s.addEventListener("change", () => on(s.value));
    return s;
  }
  function inp(cls, val, ph, on) {
    const i = document.createElement("input"); i.className = cls; i.value = val || ""; i.placeholder = ph || "";
    i.addEventListener("input", () => on(i.value));
    return i;
  }
  function delBtn(on) { const b = document.createElement("button"); b.className = "del"; b.textContent = "✕"; b.title = "Remove"; b.addEventListener("click", on); return b; }
  function deleteBtn(label, on) {
    const w = h(`<div class="prop-section"><button class="btn" style="width:100%;border-color:var(--bad);color:var(--bad)">${esc(label)}</button></div>`);
    w.querySelector("button").addEventListener("click", on);
    return w;
  }

  // ============================================================ TREE
  let draggingId = null; // element being dragged in the Model Explorer
  function reparent(dragId, targetId) {
    if (!Model.canReparent(S.model, dragId, targetId)) return;
    Model.elementById(S.model, dragId).ownerId = targetId || null;
    markDirty(true, "reparent"); renderTree(); if (S.editor) S.editor.render();
  }
  function renderTree() {
    const tree = $("modelTree"); tree.innerHTML = "";
    if (!S.model) return;
    const ul = document.createElement("ul");
    const roots = S.model.elements.filter((e) => !e.ownerId);
    const top = roots.length ? roots : S.model.elements;
    for (const e of top.filter((e) => e.type !== "note")) ul.appendChild(treeNode(e));
    tree.appendChild(ul);
    // drop on empty tree space → move to the root (un-parent)
    tree.ondragover = (ev) => { if (draggingId && !ev.target.closest(".row")) ev.preventDefault(); };
    tree.ondrop = (ev) => { if (!ev.target.closest(".row")) { ev.preventDefault(); reparent(draggingId, null); } };
  }
  function treeNode(e) {
    const li = document.createElement("li");
    const row = document.createElement("div"); row.className = "row"; row.dataset.id = e.id;
    row.innerHTML = `<span class="ico">${glyph(e.type)}</span><span>${esc(e.name)}</span>`;
    // drag-and-drop re-parenting (move between packages / into blocks)
    row.draggable = true;
    row.addEventListener("dragstart", (ev) => { ev.stopPropagation(); draggingId = e.id; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", e.id); });
    row.addEventListener("dragend", () => { draggingId = null; document.querySelectorAll(".row.drop-target").forEach((r) => r.classList.remove("drop-target")); });
    row.addEventListener("dragover", (ev) => { if (Model.canReparent(S.model, draggingId, e.id)) { ev.preventDefault(); ev.stopPropagation(); row.classList.add("drop-target"); } });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); row.classList.remove("drop-target"); reparent(draggingId, e.id); });
    row.addEventListener("click", () => {
      // always populate Properties; if the element is placed on a diagram, focus
      // it there (the current one if possible, else open one that shows it)
      if (S.diagram && S.diagram.nodes.some((n) => n.elementId === e.id)) {
        S.editor.reselect({ kind: "element", id: e.id }); S.editor.centerOn(e.id);
      } else {
        const other = S.model.diagrams.find((d) => d.nodes.some((n) => n.elementId === e.id));
        if (other) { selectDiagram(other); S.editor.reselect({ kind: "element", id: e.id }); S.editor.centerOn(e.id); }
        else { S.editor.reselect({ kind: "element", id: e.id }); } // not on any diagram — just show its Properties
      }
    });
    const items = elementMenuItems(e);
    if (items.length) row.addEventListener("contextmenu", (ev) => { ev.preventDefault(); contextMenu(ev.clientX, ev.clientY, items); });
    li.appendChild(row);
    const kids = S.model.elements.filter((c) => c.ownerId === e.id && c.type !== "note");
    if (kids.length) { const ul = document.createElement("ul"); kids.forEach((k) => ul.appendChild(treeNode(k))); li.appendChild(ul); }
    return li;
  }

  // ============================================================ VALIDATION
  function runValidation() {
    if (!S.model) return status("Open a project first.", true);
    const issues = Validate.run(S.model);
    const s = Validate.summary(issues);
    status(`Validation: ${s.error} error(s), ${s.warning} warning(s), ${s.info} info.`, s.error > 0);
    const icon = { error: "⛔", warning: "⚠️", info: "ℹ️" };
    const body = issues.length
      ? `<div class="val-summary">${s.error} errors · ${s.warning} warnings · ${s.info} info — click an item to locate it</div>` +
        `<div class="val-list">` + issues.map((iss, i) =>
          `<div class="val-row ${iss.severity}" data-i="${i}"><span class="vi">${icon[iss.severity]}</span><span>${esc(iss.message)}</span></div>`).join("") + `</div>`
      : `<div class="empty">✓ No problems found.</div>`;
    const m = modal("Model validation", body, [{ label: "Close", act: "close" }]);
    m.querySelectorAll(".val-row").forEach((row) => row.addEventListener("click", () => {
      const iss = issues[+row.dataset.i]; closeModal(); navigateToRef(iss.ref);
    }));
  }
  function navigateToRef(ref) {
    if (!ref) return;
    if (ref.kind === "diagram") { const d = S.model.diagrams.find((x) => x.id === ref.id); if (d) selectDiagram(d); return; }
    if (ref.kind === "element") {
      const d = S.model.diagrams.find((x) => x.nodes.some((n) => n.elementId === ref.id));
      if (d) { selectDiagram(d); S.editor.reselect({ kind: "element", id: ref.id }); S.editor.centerOn(ref.id); }
      else status("That element isn't placed on any diagram — drop it on one to locate it.");
      return;
    }
    if (ref.kind === "relationship") {
      const r = S.model.relationships.find((x) => x.id === ref.id); if (!r) return;
      const d = S.model.diagrams.find((x) => { const ids = x.nodes.map((n) => n.elementId); return ids.includes(r.sourceId) && ids.includes(r.targetId); });
      if (d) { selectDiagram(d); S.editor.reselect({ kind: "relationship", id: ref.id }); }
      else status("That relationship isn't shown on any diagram.");
    }
  }

  // ============================================================ MODALS
  function modal(title, bodyHtml, buttons) {
    const root = $("modalRoot"); root.hidden = false;
    root.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><div class="body">${bodyHtml}</div>
      <div class="foot">${buttons.map((b) => `<button class="btn${b.primary ? " primary" : ""}" data-act="${b.act}">${esc(b.label)}</button>`).join("")}</div></div>`;
    root.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener("click", closeModal));
    root.addEventListener("mousedown", (e) => { if (e.target === root) closeModal(); }, { once: true });
    return root.querySelector(".modal");
  }
  function closeModal() { const r = $("modalRoot"); r.hidden = true; r.innerHTML = ""; }

  // ---- lightweight right-click context menu -----------------------------
  let ctxDismiss = null, ctxKey = null;
  function closeContextMenu() {
    const m = $("ctxMenu"); if (m) m.remove();
    if (ctxDismiss) { document.removeEventListener("mousedown", ctxDismiss, true); ctxDismiss = null; }
    if (ctxKey) { document.removeEventListener("keydown", ctxKey, true); ctxKey = null; }
  }
  function contextMenu(clientX, clientY, items) {
    closeContextMenu();
    if (!items.length) return;
    const menu = document.createElement("div");
    menu.className = "ctx-menu"; menu.id = "ctxMenu";
    menu.style.left = clientX + "px"; menu.style.top = clientY + "px";
    for (const it of items) {
      const b = document.createElement("div");
      b.className = "ctx-item"; b.textContent = it.label;
      b.addEventListener("click", () => { closeContextMenu(); it.act(); });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    // Dismiss on an outside click or Escape. Crucially, a click *inside* the
    // menu must NOT be swallowed here — otherwise removing the menu on mousedown
    // would stop the item's own click from ever firing (the old bug).
    ctxDismiss = (e) => { if (!menu.contains(e.target)) closeContextMenu(); };
    ctxKey = (e) => { if (e.key === "Escape") closeContextMenu(); };
    setTimeout(() => {
      document.addEventListener("mousedown", ctxDismiss, true);
      document.addEventListener("keydown", ctxKey, true);
    }, 0);
  }
  // context-menu items for an element, by type (extensible)
  function elementMenuItems(el) {
    const items = [];
    if (el.type === "block") items.push({ label: "⊞ Create IBD from block", act: () => createIbdFromBlock(el.id) });
    return items;
  }

  // ============================================================ HELPERS
  function normalizeModel(m) {
    m = m || Model.newModel();
    m.elements = m.elements || []; m.relationships = m.relationships || []; m.diagrams = m.diagrams || []; m.tables = m.tables || [];
    if (!m.diagrams.length) m.diagrams.push(Model.newDiagram("class", "Main"));
    return m;
  }
  function glyph(type) {
    return ({
      class: "▣", interface: "◷", enumeration: "≣", datatype: "T", primitive: "t",
      component: "⬡", package: "📦", block: "▢", valueType: "#", constraint: "∑",
      interfaceBlock: "◷", requirement: "❒", actor: "☺", usecase: "◯", state: "▭",
      initial: "●", final: "◉", choice: "◇", composite: "▣", forkjoin: "▬", junction: "•", history: "Ⓗ",
      part: "▦", port: "▪", note: "🗒", instance: "▤", lifeline: "▯", dbtable: "▤",
      action: "▭", objectNode: "▭", decision: "◇", flowfinal: "⊗", partition: "▥",
      constraintProp: "∑", valueProp: "▭", comObject: "▭", timeline: "⏱",
    })[type] || "▣";
  }
  function download(content, name, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    URL.revokeObjectURL(a.href); status("Exported " + name);
  }
  // full HTML-entity encoder (covers &<>"'`/ so it's safe in any HTML context)
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"'`/]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;", "/": "&#47;" }[c]));
  }
  function h(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function safe(s) { return String(s || "diagram").replace(/[^a-z0-9_-]+/gi, "_"); }
  function fmtDate(t) { if (!t) return ""; const d = new Date(t); return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

  // ============================================================ WIRING
  $("openBtn").addEventListener("click", openDialog);
  $("openBtn2").addEventListener("click", openDialog);
  $("newBtn").addEventListener("click", newProject);
  $("newBtn2").addEventListener("click", newProject);
  $("sampleBtn").addEventListener("click", loadSample);
  $("saveBtn").addEventListener("click", save);
  $("addDiagramBtn").addEventListener("click", addDiagram);
  $("addTableBtn").addEventListener("click", addTable);
  $("sideTabs").addEventListener("click", (e) => { const b = e.target.closest(".side-tab"); if (b) setSideTab(b.dataset.side); });
  $("undoBtn").addEventListener("click", undo);
  $("redoBtn").addEventListener("click", redo);
  $("validateBtn").addEventListener("click", runValidation);
  $("importInput").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importXmiFile(f); e.target.value = ""; });
  $("zoomIn").addEventListener("click", () => S.editor.zoomIn());
  $("zoomOut").addEventListener("click", () => S.editor.zoomOut());
  $("fitBtn").addEventListener("click", () => S.editor.fit());

  const expBtn = $("exportBtn"), expMenu = $("exportMenu");
  expBtn.addEventListener("click", (e) => { e.stopPropagation(); expMenu.hidden = !expMenu.hidden; });
  document.addEventListener("click", () => { expMenu.hidden = true; });
  expMenu.addEventListener("click", (e) => { const a = e.target.dataset.act; if (a) { exportAs(a); expMenu.hidden = true; } });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
    // let native text undo/redo work while editing a form field
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(); }
  });
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

  // drag-drop XMI onto canvas
  const wrap = document.querySelector(".canvas-wrap");
  wrap.addEventListener("dragover", (e) => e.preventDefault());
  wrap.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) importXmiFile(f); });

  // ---------------------------------------------------------------- theme
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const b = $("themeBtn");
    if (b) { b.textContent = t === "light" ? "☀" : "☾"; b.title = "Switch to " + (t === "light" ? "dark" : "light") + " theme"; }
  }
  function initTheme() {
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    applyTheme(Theme.resolveInitial(localStorage.getItem(Theme.KEY), prefersLight));
  }
  $("themeBtn").addEventListener("click", () => {
    const t = Theme.nextTheme(document.documentElement.dataset.theme || "dark");
    applyTheme(t);
    try { localStorage.setItem(Theme.KEY, t); } catch (e) { /* ignore */ }
    if (S.editor && S.diagram) S.editor.render(); // refresh SVG colors for the new theme
  });
  initTheme();

  refreshConnection();
})();
