# Roadmap — Multi-User Platform: Accounts, Permissions, CM & Licensing

Status: **Draft for review.** This plans the evolution of Orrery Systems Modeler
from a single shared library with no authentication into a **licensed,
multi-user, access-controlled** product with project configuration management.

---

## 0. Decisions (locked 2026-07-03)

| Decision | Chosen | Notes |
| --- | --- | --- |
| **Deployment / sales** | On-prem, customer-hosted, **per-seat license** | Customer runs the server; we license it |
| **License enforcement** | **Offline node-locked** signed license (bound to a machine fingerprint) | No phone-home ⇒ no vendor service to host. Online live-duplicate detection is an *optional future upgrade* (§5) |
| **Identity** | **Local accounts** (hashed passwords, admin-managed); SSO later | |
| **Project CM** | **Lock + history + baselines** | Not full branch/merge |
| **Persistence** | Introduce **SQLite** for users/roles/sessions/history/audit/license-state; projects stay JSON blobs | Biggest structural change |

---

## 1. Where we are today (baseline)

- Node/Express server, framework-free browser SPA, **file-per-project JSON**
  store (`server/store.js`), optimistic-concurrency `rev` counter.
- **No authentication** — every request is anonymous and fully privileged.
- Per-IP API rate limiting and path/input hardening are already in place.
- Ships as a Docker image (GHCR) and Electron desktop app; both bundle the same
  `server/` + `public/`.

Implication: accounts, permissions, CM, and licensing are essentially
greenfield on a clean base. The main structural change is **introducing an
identity + a relational store**, then guarding everything behind it.

---

## 2. Target architecture (high level)

```
Browser SPA ──HTTPS──> Reverse proxy (TLS) ──> Orrery server (Node/Express)
                                                  ├─ Auth (sessions)         ┐
                                                  ├─ RBAC / project ACLs     │ SQLite
                                                  ├─ Project store (JSON)    │ (users, roles,
                                                  ├─ CM (locks/history/base) │  sessions, history,
                                                  ├─ Admin API               │  audit, license state)
                                                  └─ License verifier ───────┘
                                                        ▲
                                          Signed license file (Ed25519), bound to
                                          this machine's fingerprint. Verified
                                          OFFLINE with the embedded public key —
                                          no network calls.

Vendor side (offline, one-time per install): issue a license bound to the
customer's machine fingerprint using your private key + a tiny CLI signer.
```

Single deliverable in the **Orrery server** plus a small **license-signing CLI**
you (the vendor) keep private. No always-on license service to host.

---

## 3. Data model additions

New tables (SQLite). Projects can remain JSON files keyed by id, or move into a
`projects` table as blobs — either works; SQLite gives transactions + queries.

- **users** — `id, username, email, password_hash (argon2id/bcrypt), status
  (active|disabled), global_role (admin|user), created_at, last_login_at`.
- **sessions** — `id, user_id, created_at, expires_at, ip, user_agent` (or use
  signed cookies + a rolling secret; server-side sessions allow revocation).
- **project_members** — `project_id, user_id, role (owner|editor|viewer)`.
- **project_locks** — `project_id, user_id, acquired_at, expires_at` (heartbeat-
  renewed; auto-expires so a crashed client can't hold a lock forever).
- **project_versions** — `project_id, rev, author_id, created_at, message,
  snapshot (JSON)` — append-only history for restore/compare.
- **baselines** — `id, project_id, rev, name, notes, created_by, created_at`.
- **audit_log** — `id, ts, actor_id, action, target, detail` (logins, admin
  changes, license events, restores).
- **license_state** — installed signed license, this install's `instance_id` and
  captured **machine fingerprint**, seat-usage snapshot, last-verified time.

---

## 4. Phased plan

Ordering rule: **identity must land first** — locks, permissions, CM authorship,
and seat counting all need "who is this user."

### Phase 1 — Authentication  ✅ *shipped (initial)*
> **Implementation note:** Phase 1 landed on the existing **file-store** pattern
> (scrypt hashing + JSON-backed user/session stores under `<DATA_DIR>/.auth/`),
> **not** SQLite. Rationale: zero new dependencies and identical behaviour in
> Docker **and** Electron. Node's built-in `node:sqlite` works in the Alpine
> image but its availability in Electron's bundled Node is unverified, so SQLite
> adoption is deferred to the phase that needs relational queries (CM/history),
> where it can be validated against Electron. Everything below remains the plan.

- Add SQLite (recommend `better-sqlite3`: embedded, synchronous, zero-ops) and a
  small migration runner.
- Password hashing (`argon2id` via a prebuilt binding, or `bcryptjs` pure-JS to
  avoid native build steps in Alpine/Electron).
- **Login / logout**, session cookies (`httpOnly`, `Secure`, `SameSite=Lax`),
  session expiry + "remember me", and **login rate-limiting + lockout** (extends
  the existing `express-rate-limit`).
- **First-run bootstrap**: create the initial admin from env vars
  (`ADMIN_USER` / `ADMIN_PASSWORD`) or a one-time setup screen.
- Auth middleware; every existing API route requires a session. Provide a
  transition flag (`AUTH_OPEN=1`) so current single-team installs keep working
  during rollout, then flip it off.
- **Migration**: assign all existing anonymous projects to the initial admin.

### Phase 2 — Authorization (roles & project permissions)  ✅ *shipped*
- **Global roles**: `admin` (manage users/license/all projects) and `user`.
- **Per-project roles**: `owner` (manage members + delete), `editor` (read +
  write), `viewer` (read-only).
- Guard middleware: `requireProject(role)` on every project route; the project
  list is filtered to what the user may see.
- SPA: hide/disable actions the user can't perform; show role badges.
- Pure, unit-testable `can(user, action, project)` policy function.

### Phase 3 — Admin page  ✅ *shipped*
- `/admin` (admins only): **add / remove / disable users**, reset passwords,
  set global role, assign project membership, view **seat usage (N of M)**,
  view **active sessions and live server instances**, and **license status**.
- Admin API (`/api/admin/*`) guarded by the admin role; all actions audited.

### Phase 4 — Project Configuration Management  *(4a history/baselines ✅ shipped; 4b locking next)*
- **Locking (check-out/check-in):** a user takes an exclusive lock to edit;
  others are read-only until release. Locks are heartbeat-renewed and
  auto-expire. This complements the existing `rev` optimistic check (which
  guards accidental races) with intentional exclusive editing — matching the
  established "shared library, separate work" model.
- **History:** every save writes an immutable `project_versions` row (author,
  timestamp, message). **Restore** any prior version; **compare** two versions
  (model-diff — start with element/relationship add/remove/change).
- **Baselines:** name an immutable snapshot of a specific version (e.g. "PDR",
  "v1.0 released") for release/audit traceability.
- Storage: full snapshots per version first (simple, correct); add diff/pruning
  later if size matters.

### Phase 5 — Licensing (offline, node-locked)
- **License file** = a compact token signed with **Ed25519** by the vendor,
  containing `licenseId, customer, seats, features, issuedAt, expiresAt,
  fingerprint`. The server ships with the **public key** and verifies
  authenticity + expiry **offline** — no network calls.
- **Activation flow (offline, one-time):** on first run the server computes a
  **machine fingerprint** and shows a **request code**. The customer sends it to
  you; you sign a license **bound to that fingerprint** with the private key (via
  a small vendor-only CLI) and send it back; the admin uploads it. The license is
  now valid only on that machine.
- **Machine fingerprint:** a stable composite (e.g. machine-id + primary MAC +
  disk/CPU identifiers), hashed. Chosen for stability across reboots but
  uniqueness across machines. On a genuine hardware change the customer
  re-activates (re-issue).
- **Seat model:** *named seats* — the number of `active` user accounts may not
  exceed `seats`. Admin sees usage; creating/enabling an account is blocked at
  the cap. (Optional concurrent-login overlay later.)
- Degraded mode: expired / wrong-fingerprint / invalid license → **read-only**
  with an admin banner (never destructive; never silent data loss).

### Phase 6 — *(optional, future)* Online live-duplicate detection
Node-locking (Phase 5) stops a license file being **copied to a different
machine**, but two clones with the **same fingerprint** would both validate
offline. Closing that last gap requires connectivity. If it's ever wanted, add
an optional heartbeat: a small vendor service records a signed heartbeat per
`instance_id`; if two live instances share one license, the newer is refused
(read-only + admin warning), with a signed grace lease for vendor outages. This
is **out of scope** given the offline-only decision, and is noted here only as a
future upgrade path.

### Phase 7 — Hardening & enterprise
- **TLS** (document reverse-proxy setup: Caddy/nginx; Secure cookies require it).
- **CSRF** protection for cookie auth (SameSite + tokens on mutating requests).
- **Audit log** UI, DB **backup/restore** guidance, password policy.
- Optional **SSO**: OIDC/SAML or LDAP/AD binding (many enterprises require it
  before an on-prem purchase).

---

## 5. Preventing the same license key on multiple servers

**Chosen approach: offline node-locking.** The license is cryptographically
**bound to one machine's fingerprint**, so copying the license file to a second
server fails to validate there. The mechanics:

1. Each install computes a stable **machine fingerprint** and a persisted
   `instance_id`.
2. You issue the signed license **for that specific fingerprint** (one license
   per authorized machine).
3. On every boot the server verifies the Ed25519 signature, expiry, **and that
   the license's fingerprint matches this machine.** A mismatch ⇒ read-only with
   an admin banner. So a copied license simply won't run elsewhere.

**What this does and doesn't guarantee (be honest):**
- ✅ Stops the common case: the same license file dropped onto a *different*
  server won't work (different fingerprint).
- ✅ Enforces the **seat cap** inside the signed license regardless of network.
- ⚠️ Does **not** detect two clones that share an **identical fingerprint**
  (e.g. a byte-for-byte VM clone with the same machine-id). Offline, there is no
  central "is this key live twice right now?" check — that fundamentally needs
  connectivity.

**Mitigations for the clone gap (still offline):**
- Use a **composite, hard-to-spoof fingerprint** (machine-id + MAC + disk/CPU
  serials), hashed; a plain VM clone usually changes at least one component.
- Persist `instance_id` to protected storage and **detect fingerprint drift**
  (if the underlying identifiers change under a running install, flag a possible
  clone in the audit log / admin page).
- **Contractual + audit:** the signed license names the customer; the admin page
  surfaces the bound fingerprint and any drift for compliance.

**If stronger guarantees are ever needed** (detecting concurrent identical
clones), the only real fix is the **optional online heartbeat** in Phase 6 —
explicitly out of scope under the offline-only decision, but a clean upgrade
that reuses the same `instance_id`.

**Anti-tamper details:** licenses are **Ed25519-signed** (server holds only the
public key); the stored license/fingerprint state is signed so it can't be
edited to bypass checks; tolerate modest clock skew; the vendor private key
never ships — it lives only in the signing CLI.

---

## 6. Security considerations (cross-cutting)

- HTTPS everywhere; Secure/HttpOnly/SameSite cookies; CSRF tokens on mutations.
- `argon2id`/bcrypt hashing, login lockout, optional password policy + 2FA later.
- Principle of least privilege on every route; the pure `can()` policy is the
  single choke point and is unit-tested.
- Audit trail for auth, admin, license, and CM (restore/baseline) events.
- Backups of the SQLite DB; document restore.
- Secrets per-install (session secret); vendor keys stay with the vendor.

---

## 7. Migration & backward compatibility

- Ship auth **off by default for one release** (`AUTH_OPEN`) so existing installs
  aren't locked out on upgrade; first admin + existing-project ownership are
  created on first authenticated boot; then require auth.
- Keep the REST API shape; add auth middleware and version the API if needed.
- The Electron app reuses the same server + login screen (local single-user can
  auto-provision an admin so the desktop experience stays one-click).

---

## 8. Testing

- **Unit (pure, fits `node --test`):** `can()` policy matrix, license
  verification (signature/expiry/seat math), lock state machine, seat counting,
  heartbeat lease validation.
- **Integration (HTTP):** login/logout/lockout, admin user CRUD + seat cap,
  project permission enforcement, CM lock/checkout/restore/baseline.
- **License signing CLI:** its own tests — sign/verify round-trip, fingerprint
  binding, expiry + seat encoding, tamper rejection.

---

## 9. Suggested sequencing

1. **Phase 1** Auth + SQLite foundation — *large*
2. **Phase 2** RBAC + project ACLs — *medium*
3. **Phase 3** Admin page — *medium*
4. **Phase 4** Project CM (lock/history/baselines) — *large*
5. **Phase 5** Licensing offline (signed license + seat cap + node-lock + signing CLI) — *medium*
6. **Phase 6** *(optional/future)* online live-duplicate detection — *deferred*

Phases 1→3 unlock everyday multi-user value fastest. CM (4) and licensing (5)
can be sequenced to match go-to-market. Each phase ships behind flags and keeps
the app usable throughout. Hardening (TLS/CSRF/audit/backups) is folded into the
relevant phases; SSO/LDAP is a later add-on.

---

## 10. Decisions & remaining questions

**Decided (2026-07-03):** on-prem per-seat · offline node-locked licensing ·
local accounts first · CM = lock+history+baselines · SQLite for platform data.

**Still to settle before/within the relevant phase:**
1. **Seat model** — *named seats* (cap on enabled accounts, assumed) vs
   *concurrent logins*? Named is simpler to enforce/audit; decide in Phase 5.
2. **Fingerprint composition & re-activation policy** — which identifiers, and
   how lenient is re-activation on hardware change / cloud-image redeploys?
   (Decide in Phase 5; affects support load.)
3. **License delivery UX** — email a request code + upload the license file, vs a
   customer portal. (A CLI + file exchange is enough to start.)
4. **SSO/LDAP** — needed for the first enterprise sale, or is local-accounts
   sufficient for v1? (Deferred; slots after Phase 3.)
5. **Password/2FA policy** — minimum policy for v1; 2FA later.
