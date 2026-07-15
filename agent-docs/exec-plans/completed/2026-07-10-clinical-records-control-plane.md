# Clinical Records SMART Control Plane

Status: completed
Updated: 2026-07-14

## Goal

Ship the smallest backend Epic SMART-on-FHIR control plane and bounded hosted
retrieval port that can support the Fable user experience without moving
provider credentials or patient identifiers into assistant/runtime state.

Success means `apps/web` owns a versioned provider directory, member-bound
single-use connect intents, PKCE/state-bound SMART authorization sessions,
clinical-specific encrypted connection authority, durable retrieval-run status,
and member-authorized status/disconnect APIs. Launch consent, account export,
and account deletion cover every new durable row.

## Constraints

- Build on PR #458's raw-first clinical-record contracts without changing its
  canonical import ownership.
- No user-facing React or page implementation in this lane.
- Provider passwords never transit Murph; OAuth credentials and patient ids are
  encrypted in the web control plane and never enter prompts, logs, Temporal,
  or the hosted workspace.
- Provider and FHIR endpoints come only from the server-owned directory.
- Keep the first vertical Epic-specific where provider behavior requires it,
  but keep connection state source-system neutral.
- Migrations are additive and compatible with the currently deployed web app.
- One member/provider connection owns one initial retrieval generation. Do not
  enable another raw-evidence job until its immutable references have a bounded
  retention lifecycle.

## Persisted State Classification

All new Prisma rows are web-owned hosted product/control facts in Postgres:

- provider directory entries are public, versioned control configuration;
- connect intents and OAuth sessions are short-lived authorization/idempotency
  state;
- connections are durable member-scoped provider authority;
- retrieval runs are bounded durable operational status and idempotency state.

Canonical clinical truth and raw FHIR evidence remain in the encrypted vault;
the control plane stores no raw FHIR resources or record contents.

## Implementation

1. Inventory the existing hosted auth, legal consent, crypto, device-connect,
   connected-app, privacy export/deletion, and route-test patterns.
2. Add additive Prisma models, indexes, relations, and SQL migration.
3. Add a versioned provider-directory parser/search owner and committed artifact
   generated offline from Epic's current public endpoint bundle.
4. Add clinical-specific crypto contexts plus connect-intent, OAuth-session,
   SMART discovery/token exchange, connection, retrieval-run, status, and
   disconnect services.
5. Add authenticated/internal route handlers for directory search, connect
   launch, callback, status, disconnect, and the write-fenced runtime retrieval
   port without adding frontend pages.
6. Extend legal consent, account export/deletion, architecture, security,
   reliability, and testing documentation.
7. Add focused tests and run the truthful `apps/web` verification lane.
8. Hand off for required security/privacy and coverage audits, final review,
   scoped plan closure, commit, push, and PR creation by the coordinating lane.

## Verification

- Prisma format, validate, generate, and migration SQL inspection.
- Focused Vitest coverage for live provider-directory search/validation, SMART
  scope and bounded-stream behavior, callback redaction, runtime fences,
  two-page raw pagination, exact-family cursors, 401/403 handling, request/token
  CAS races, preemption/outcome replay, and export/deletion coverage.
- `pnpm test:diff` for the exact touched `apps/web` and durable-doc paths when it
  truthfully covers the lane; otherwise `pnpm --dir apps/web verify` plus the
  focused tests.
- `git diff --check` and a privacy/secret/path leakage review.

## Deployment Compatibility

The migration is additive and deploys before the new web build. Old web code
ignores the new tables. The backend routes remain unreachable from a product UI
until the later Fable lane ships. Rollback to the pre-control-plane web build is
safe while the additive tables remain.

## Deferred

- User-facing pages and visual design.
- Provider-directory network refresh jobs; refresh remains an explicit offline
  import and reviewed artifact update.
- Oracle and other provider-specific adapters.
- Scheduled refresh, record removal, and positive clinical resource mappings.
- Retry, reconnect, and reauthorization after an initial retrieval.

## Current evidence

- Prisma schema validates and the migration is additive.
- The committed Epic directory contains 1,243 brands and 92,016 facility
  locations in 6,966,496 bytes from Epic's 2026-07-11 bundle.
- Focused tests prove Atlanta/Piedmont lookup, public-only endpoints, SMART
  partial grants, missing/false Content-Length bounds, signed runtime fences,
  raw two-page Bundle continuity, exact-family pagination, credential/page-claim
  compare-and-swap races, preemption, outcome replay, and privacy coverage.
- Provider fetches reserve the per-run request and charged-egress budgets before
  network I/O; server-derived page claims prevent caller-id fanout, and bounded
  completed replays do not double-count logical page progress.
- The member/provider uniqueness boundary rejects a second connection before
  provider discovery and again transactionally, so this lane exposes exactly
  one bounded raw-evidence job per connection.
- The security/privacy completion audit found no evidence-backed critical,
  high, or medium issue across the exact producer/control-plane trust boundary.
- Focused web and privacy coverage passes 106 tests and now proves claim,
  member, provider, browser-session, run, and generation binding plus safe
  connection projection, disconnect ownership, and escaped or wrong-family
  FHIR response rejection. The runtime-state crypto proof passes all 4 focused
  tests; its focused coverage invocation reports only the package-wide
  threshold for unrelated unselected files.
Completed: 2026-07-14
Completed: 2026-07-14
