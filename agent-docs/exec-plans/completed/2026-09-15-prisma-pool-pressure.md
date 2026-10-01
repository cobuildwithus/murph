# Sample database pool pressure at connection checkout

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

Report prospective connection contention only when a caller actually requests
another pooled connection. Statements using an acquired transaction connection
must not generate a false pressure warning.

## Scope and constraints

Keep the shared Web Prisma pool as the owner. Preserve pool size, failure
classification, retry policy, transaction semantics, and Vercel pool lifecycle.
No new dependencies, timers, queues, durable state, or production changes.

## Tasks

1. Reproduce false pressure with real PostgreSQL and a single-connection pool.
2. Move existing pressure sampling to the public pool checkout method.
3. Verify healthy transactions, real competing checkouts, both checkout API
   forms, retry invariants, and Web types; review and commit the scoped fix.

## Risks and mitigations

- Checkout supports callback and promise forms: forward receiver, arguments,
  return values, and failures unchanged; cover both forms.
- Transaction statements and standalone queries can share an async scope:
  sample actual checkout rather than inferring it from transaction context.
- Preserve existing per-pool sampling and conservative retry backpressure.

## Verification

- Baseline real PostgreSQL proof reproduced the warning from a healthy
  interactive transaction holding the only connection; the batch case passed.
- Focused Vitest run: 90 unit tests passed. The first full PostgreSQL run found
  schema-creation permissions unavailable on the shared test database; all 15
  PostgreSQL tests passed after preparing a new task-owned local database.
  The database was used only for synthetic fixtures and retired after proof.
- Strict focused typecheck of the Prisma owner and both test files passed,
  extending the existing Web compiler options with the same source paths.
- Full Web typecheck passed, including the ordinary generated-input preflight.
- `pnpm complexity:diff` passed: unchanged debt and maximum complexity. The
  pre-existing error classifier hotspot is untouched; no refactor is justified.
- Candidate review covered checkout receiver, arguments and return forwarding,
  actual first-waiter sampling, per-pool throttling, transaction reuse, standalone
  checkout inside a transaction scope, retry behavior, and authored-data privacy.

Commands used: `pnpm exec vitest run --config apps/web/vitest.workspace.ts
--no-coverage --maxWorkers 1` with the two Prisma suites; real PostgreSQL uses
`MURPH_TEST_POSTGRES_CONCURRENCY=1` and a loopback-only `DATABASE_URL`.
Full typecheck: `MURPH_TSC_WEB_CHECKERS=1 pnpm --dir apps/web typecheck`.

This is internal diagnostic correctness; no member-facing behavior or public
changelog change. No schema or runtime-protocol change is shipped. Deployment
remains separate; the fix needs only an ordinary Web release.
Completed: 2026-09-15
