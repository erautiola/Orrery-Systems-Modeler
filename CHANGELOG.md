# Changelog

All notable changes to Orrery Systems Modeler are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Test suite** — unit tests for the project store and integration tests that
  drive the REST API over HTTP (Node's built-in `node --test`; no new deps).
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

[0.1.1]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.1
[0.1.0]: https://github.com/erautiola/Orrery-Systems-Modeler/releases/tag/v0.1.0
