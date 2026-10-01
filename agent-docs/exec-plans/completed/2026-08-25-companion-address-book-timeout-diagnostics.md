# Diagnose companion address-book request stalls

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Reproduce the companion address-book status read against local PostgreSQL.
- Make a future hosted timeout identify the exact incomplete request stage
  without logging member, token, contact, or request data.
- Preserve the existing authentication, privacy, response, and write behavior.

## Scope

- In scope: the companion address-book GET route, privacy-safe stage timing,
  focused route coverage, and a local PostgreSQL status-query proof.
- Out of scope: changing route authorization, adding retries, changing the
  address-book schema, altering client behavior, or claiming a database fix
  before a production stall identifies the failing stage.

## Constraints

- Emit only fixed event and stage labels plus bounded numeric timing data.
- Emit a diagnostic before Vercel's 60-second function deadline while leaving
  the in-flight operation and response behavior unchanged.
- Avoid steady-state log volume by reporting only requests that cross the slow
  threshold.
- Keep the implementation local to the route unless an existing shared owner
  is demonstrably reusable.

## Tasks

1. Run the exact status query against local PostgreSQL and inspect its plan and
   operation timing.
2. Add a small slow-stage observer around authentication and status lookup.
3. Add focused fake-timer coverage for both stalled stages, normal completion,
   and privacy-safe log fields.
4. Run focused tests, Web typecheck, diff/privacy inspection, then commit, push,
   open the PR, and run the required exact-head review and CI gates.

## Verification

- Focused companion address-book route tests.
- Real local PostgreSQL status-query timing and `EXPLAIN (ANALYZE, BUFFERS)`
  using synthetic rows only.
- Web typecheck.
- `git diff --check` and identifier/privacy inspection.
- Exact-head CI and required ReviewGPT passes.

## Product UX

- No user-visible response, authorization, or recovery behavior changes.
- The operational improvement is an exact fixed-label diagnosis on any future
  slow GET so the underlying database or authentication stage can be fixed
  without exposing private address-book data.
- Identity-token verification, member lookup, and status lookup retain their
  existing order and error behavior. Normal requests clear every diagnostic
  timer without emitting a log. Result: ready.

## Local Evidence

- The exact Prisma status read against current local PostgreSQL with the maximum
  1,000 synthetic contacts completed 20 warm reads at 1.119 ms median and
  6.067 ms maximum.
- The exact SQL plan executed in 0.248 ms. This did not reproduce the hosted
  stall and rules out the bounded status query as intrinsically slow; the
  remaining evidence points to an intermittent connection/socket wait until a
  future stage warning identifies the incomplete await.
- Focused companion route and bearer-auth suites: 22 tests passed.
- Web typecheck passed after generating the standard ignored Health Commons
  artifact required by a fresh worktree.
Completed: 2026-08-25
