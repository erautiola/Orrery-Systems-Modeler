# Changelog

All notable changes to Orrery Systems Modeler are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Drag-and-drop in the Model Explorer**
  ([#43](https://github.com/erautiola/Orrery-Systems-Modeler/issues/43)). Drag a
  tree row onto a **package** or **block** to re-parent it (move between packages,
  add to a block); drop on empty tree space to move it back to the root. Cycles
  are rejected. New pure `Model.canReparent` (unit‑tested). The renderer now only
  visually nests children under real containers (package / composite state /
  partition), so logical ownership on a block no longer jams its children inside
  the block box.
- **Tabbed workspace.** Diagrams and tables now open as **tabs** — several can be
  open at once and you switch between them with a tab strip above the canvas
  (each diagram tab remembers its own pan/zoom). The left sidebar's **Diagrams**,
  **Tables**, and **Explorer** are now **tabs** rather than stacked panels. New
  pure `tabs.js` open‑tabs reducer with unit tests.
- **Block structure in Properties.** Selecting a block now lists its **Parts**
  (its composition/aggregation part‑properties and any parts it owns, as
  `role : Type [mult]`) and its **Ports** (both on the block boundary and nested
  on its parts). Each row is **click‑to‑locate** on a diagram. New pure
  `Model.blockPorts` (unit‑tested).
- **Create an IBD from a block**
  ([#34](https://github.com/erautiola/Orrery-Systems-Modeler/issues/34)).
  Right‑click a block (canvas or Model Explorer) or use **⊞ Create IBD from this
  block** in Properties; the **＋** *New diagram* dialog also lets you pick the
  **owning block** when the type is IBD. A part‑picker lists the block's parts
  (from its composition/aggregation relationships and any parts it already owns)
  as `role : Type [mult]`; the chosen ones are placed on a new IBD drawn with the
  block as a **«block» boundary frame**. New pure `Model.blockParts` /
  `Model.createIbdFromBlock` (unit‑tested) and a lightweight right‑click context
  menu.

### Changed
- **Model Explorer** now **populates Properties** on click (and focuses the
  element on a diagram if it's placed) instead of prompting to add it to the
  current diagram.

### Fixed
- **Right‑click “Create IBD” now works**
  ([#45](https://github.com/erautiola/Orrery-Systems-Modeler/issues/45)). The
  context‑menu dismiss handler was removing the menu on the item's own mousedown,
  so the item's click never fired — the menu appeared but nothing happened, in
  both the canvas and the Model Explorer. It now dismisses only on an *outside*
  click (or Escape), and the editor ignores non‑left mouse buttons so a
  right‑click no longer starts a stray drag/selection.
- **Requirement text wraps**
  ([#44](https://github.com/erautiola/Orrery-Systems-Modeler/issues/44)). A
  requirement's tag rows (`id = …`, `text = …`) now word‑wrap to the box instead
  of overflowing, and requirement boxes get a readable minimum width.
- **IBD ports & parts.** Ports can now attach to the **block boundary frame** of an
  IBD (drop one on the frame edge, or pick the block under *On part / boundary*) —
  previously a port meant for the enclosing block landed loose inside it. Parts
  imported from a block also **stay owned by that block** when moved; dragging one
  no longer detaches it from the block (it was falling out to the model root).
  Port hit‑target enlarged for easier selection.
- **Long element names now wrap** inside their box instead of overflowing the
  edges ([#33](https://github.com/erautiola/Orrery-Systems-Modeler/issues/33)).
  Names are word-wrapped (with hard-breaking for a single over-long word) and the
  box header grows to fit the extra lines. New pure `text-wrap.js` module with
  unit tests.

### Security
- Resolved the CodeQL code-scanning findings: `path.basename` + containment
  guard on project-file paths (path-injection / untrusted file write), newline
  stripping on logged request paths (log-injection), per-IP **rate limiting** on
  the API (`express-rate-limit`), a fuller HTML-entity encoder for UI text, and a
  few code-quality cleanups.

## [0.1.6] - 2026-07-01

### Added
- **Easy install** — a prebuilt image is published to **GHCR** on each release
  (`docker run ghcr.io/erautiola/orrery-systems-modeler:latest`, plus
  `docker-compose.ghcr.yml`), and **standalone desktop installers**
  (Windows/macOS/Linux, Electron) that run Orrery in their own window with no
  browser or Docker.
- **Richer IBD port/flow semantics** — ports **snap to their part's border** and
  carry a **direction** (in/out/inout, shown as a triangle), a **flow type**, and
  a **conjugated** flag (`~`); drop a port onto a part (or reassign via *On part*)
  to attach it. **Item flows** carry a typed item and render as `«flow» item :
  Type` with a directional arrow.

## [0.1.5] - 2026-06-30

### Added
- **Model validation** — a ✓ Validate action runs a rules engine (unnamed
  elements, dangling relationships, generalization cycles, empty enumerations,
  abstract types without subtypes, tables without a primary key, FK column
  mismatches, requirements missing id/text, diagrams referencing deleted
  elements, …). Issues are grouped by severity and **click-to-navigate** to the
  element. Pure `validate.js` module with unit tests.

## [0.1.4] - 2026-06-30

### Added
- **Timing diagrams** — timelines with state lanes and a step function over a
  time axis (editable states, time length, and state changes). Completes OMG
  diagram coverage.
- **Communication diagrams** — objects (`role:Class`, underlined) linked by
  **sequence-numbered directed messages** (`1: doIt()`).
- **Undo / redo** — snapshot-based history across all model edits (create, move,
  resize, connect, delete, property/table/matrix edits, diagram management).
  Top-bar ↶/↷ buttons and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; typing bursts coalesce
  into one step. Pure history module (`history.js`) with unit tests.

## [0.1.3] - 2026-06-29

### Added
- **Light / dark theme toggle** — a top-bar switch (persisted to the browser,
  defaulting to OS preference). The chrome and the SVG diagram palette (canvas,
  edges, labels, markers) are theme-aware via CSS variables read by the renderers.
- **Activity diagrams** — actions, decision/merge, fork/join, initial/final/flow-final,
  object nodes, and **swimlane partitions** (drag nodes in to assign lanes);
  **control flow** (with `[guard]`) and **object flow** connectors.
- **Parametric diagrams (SysML)** — constraint properties (`{expression}` +
  parameters) and value properties (type/value), joined by **binding connectors**.
- **Contribution policy + enforced gate** — `CONTRIBUTING.md` and a PR template
  require tests **and** docs for every feature; a new CI check **“Feature
  checklist (tests + docs)”** fails any PR that changes source without updating
  both (bypass via the `skip-feature-gate` label; Dependabot exempt).

## [0.1.2] - 2026-06-29

### Added
- **ER / Data Model diagrams** — database tables with columns (type, PK, NOT NULL,
  UNIQUE, default), foreign-key relationships in **crow's-foot** notation, and
  **SQL DDL export** (`CREATE TABLE` + `ALTER TABLE … FOREIGN KEY`, reserved-word
  quoting). New "SQL DDL (.sql)" entry in the Export menu.
- **Test suite** — unit tests for the project store, the **SQL DDL generator**,
  and the **model factory/catalog**, plus integration tests that drive the REST
  API over HTTP (Node's built-in `node --test`; no new deps). `model.js` and
  `sql-export.js` are now dual-environment (browser + Node) so they're testable.
- CI now **runs unit + integration tests** (dedicated job) and **re-runs the
  suite inside the freshly built Docker image** before a build is considered green.
- **Dependabot auto-merge** workflow — patch/minor and GitHub-Actions updates
  merge automatically once required checks pass; major bumps are held for review.

## [0.1.1] - 2026-06-28

### Changed
- **Dependency updates (Dependabot):** Express **4 → 5.2.1**; `actions/checkout`
  → v7, `actions/setup-node` → v6, `github/codeql-action` → v4,
  `actions/dependency-review-action` → v5; Docker base image → `node:26-alpine`.
- **CI runtime patches** — resolved the Node 20 action deprecation; lint/audit
  job runs on Node 22; **Dependency Review now enforces** (fails PRs on
  high-severity vulnerable dependency additions) now that the Dependency Graph
  is enabled.

### Added
- **Branding** — logo in the app header, favicon (`orrery_icon`), empty-state
  mark, and a theme-aware logo in the README. Tagline: *An MBSE Tool · EDA4 LLC*.

### Verified
- App boots and serves correctly on **Express 5 / Node 26** — REST routes and the
  RegExp SPA-fallback route confirmed.

## [0.1.0] - 2026-06-28

### Added
- Server-based, multi-user modeling tool (Node/Express + Docker) with a shared,
  conflict-checked project library.
- Diagram authoring: Class, Package, Component, SysML BDD/IBD/Requirement,
  Use Case, State Machine (composite states, regions, pseudostates), Sequence.
- Tables & matrices: element / requirements / interface tables and a dependency
  matrix, all with CSV export.
- OMG XMI import and export.
- Documentation set with embedded PlantUML UML & SysML diagrams, an importable
  self-model XMI, and CI/CodeQL/Dependency-Review/Dependabot pipelines.

[0.1.6]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.6
[0.1.5]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.5
[0.1.4]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.4
[0.1.3]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.3
[0.1.2]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.2
[0.1.1]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.1
[0.1.0]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.0
