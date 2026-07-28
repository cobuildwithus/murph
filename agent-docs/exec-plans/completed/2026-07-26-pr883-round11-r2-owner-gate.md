# Replace the PR 883 log drain with an R2 ownership gate

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Resolve the round-11 ReviewGPT finding that one successful Vercel logs query
  cannot prove it completely enumerated every pre-maintenance account-deletion
  request.
- Keep destination creation impossible when the frozen OC bucket contains any
  user-scoped object whose canonical hosted-member owner no longer exists.
- Remove the review-induced runtime-log protocol instead of adding another
  cursor, delay, poll, durable owner, queue, lease, or reconciliation process.

## Protected invariants

- Account deletion is declined before the destination exists and remains
  declined until OC retirement or guarded abandonment completes.
- The migration never copies an R2 namespace that cannot be joined to a current
  canonical `hosted_member` row.
- Missing, partial, delayed, or empty observability output cannot authorize
  destination creation.
- The ownership check keeps member ids and R2 object keys in process memory
  only and reports counts without identifiers.
- Account deletion remains available outside the bounded maintenance window.

## Evidence and retrospective decision

- Round 11 accepted a review-induced High: route markers fix the prior
  pause-before-marker race only for Vercel request events that the logs query
  actually returns. Vercel documents filters, result limits, and retention but
  no complete-enumeration or bounded-indexing contract.
- The repeated mechanism is inference from an incomplete observability scan.
  Runtime logs therefore leave the migration correctness boundary entirely.
- The existing durable authorities are sufficient. After the maintenance
  deployment and Skew Protection Threshold close admission, the runbook waits
  the documented absolute Vercel invocation bound. It then compares two stable
  frozen-source R2 inventories with namespace ids derived in memory from one
  complete read-only `hosted_member` query.
- A prior deletion that removed its member row but left any R2 object produces
  an unowned namespace and blocks destination creation even if its request log
  was missing or delayed. A fully completed deletion leaves no object to copy.
- This is a temporary migration gate over existing Postgres and R2 owners. It
  adds no persisted product or operational state and is deleted with the
  migration tooling after OC retirement.

## Tasks

1. Add a source-only, read-only active-owner gate to the temporary R2 migration
   tooling, with production-safe child environments and identifier-free output.
2. Cover active ownership, missing ownership, ambiguous key shape, unstable
   inventory, and owner-query failure through focused tests.
3. Delete route entry/terminal markers and every Vercel-log query from the
   migration contract; retain only the maintenance guard and explicit route
   lifetime.
4. Rewrite section 5 around maintenance threshold activation, the absolute
   invocation drain, and the active-owner gate before destination creation.
5. Run focused tests, typechecks, runbook command validation, canonical diff
   and acceptance verification, parent final review, CI, and the next exact-head
   ReviewGPT round.
6. Close this plan through the normal scoped final commit path and leave PR 883
   open and unmerged.

## Verification

- `pnpm --dir apps/cloudflare exec vitest run --config
  apps/cloudflare/vitest.node.workspace.ts
  apps/cloudflare/test/deploy-r2-bundles-migration.test.ts --no-coverage`
  passed: 46 tests.
- `pnpm --dir apps/web exec vitest run --config
  apps/web/vitest.workspace.ts apps/web/test/settings-privacy-delete-route.test.ts
  --no-coverage` passed: 6 tests.
- `pnpm --dir apps/cloudflare typecheck` and
  `pnpm --dir apps/web typecheck:prepared` passed.
- Every runbook Bash block passed `bash -n`; the owner-gate CLI help rendered;
  stale runtime-marker and Vercel-log query scans were clean.
- Canonical `pnpm test:diff ...` passed the affected Web and Cloudflare lanes.
- Canonical `pnpm verify:acceptance` passed all workspace typechecks, coverage,
  app verification, production builds, package boundaries, documentation
  gardening, and artifact guards.
- Parent final review found no identifier leakage, new persisted state,
  correctness dependency on observability, or simpler invariant-preserving
  alternative.
Completed: 2026-07-26
