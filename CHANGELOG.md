# Changelog

All notable changes to Orrery Systems Modeler are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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

[0.1.3]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.3
[0.1.2]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.2
[0.1.1]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.1
[0.1.0]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.0
