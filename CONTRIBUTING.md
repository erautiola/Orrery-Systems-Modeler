# Contributing to Orrery Systems Modeler

## Workflow

`main` is protected — no direct pushes. All changes land via pull request:

```bash
git checkout -b feat/my-change
# … make changes …
git commit -m "…"
git push -u origin feat/my-change
gh pr create        # or open the PR on GitHub
# CI must pass, then squash-merge
```

## Definition of Done (policy)

**Every feature must update, create, and/or refresh both tests and documentation
before it is merged.** Concretely, for any PR that changes feature/source code
(`public/js/**` or `server/*.js`):

1. **Tests** — add or update **unit and/or integration tests** under
   `server/test/**`. Run locally with `cd server && npm test` (Node's built-in
   `node --test`; browser modules like `model.js` / `sql-export.js` are
   dual-environment so they're unit-testable).
2. **Documentation** — add or refresh the relevant docs: `docs/**` (including a
   PlantUML diagram in `docs/diagrams/` where it helps), `README.md`, and the
   `CHANGELOG.md` entry.

This is **enforced in CI** by the **“Feature checklist (tests + docs)”** check,
which fails a PR that changes source without touching both tests and docs.

### Exceptions

For genuinely non-feature PRs (pure infrastructure, dependency bumps, typo
fixes), add the **`skip-feature-gate`** label to the PR. Dependabot PRs are
exempt automatically.

## CI checks (all required to merge)

- **Lint & dependency audit** — `node --check` + `npm audit`
- **Unit & integration tests** — `npm test`
- **Feature checklist (tests + docs)** — the policy gate above
- **Docker image builds & tests** — builds the image and re-runs the suite in it
- **Analyze (CodeQL)** — static security/quality analysis
- **Dependency Review** — flags vulnerable dependency changes

## Tests at a glance

- `server/test/store.test.js` — store unit tests
- `server/test/api.test.js` — REST API integration tests
- `server/test/model.test.js` — model factory/catalog unit tests
- `server/test/sql-export.test.js` — SQL DDL generator unit tests
