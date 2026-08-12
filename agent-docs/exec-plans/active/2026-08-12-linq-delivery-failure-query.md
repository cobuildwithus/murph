# Bound signup-delivery failure recomputation

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Keep terminal signup-delivery failure recomputation index-bounded while
  preserving the member/day suppression projection exactly.

## Success criteria

- Failure settlement no longer loads every live invite-signup delivery sharing
  a member/day source-reference prefix.
- The store answers only the two required questions: whether the exact failed
  identity still has a live attempt and whether any live member/day identity
  remains.
- Prefix work is backed by a narrowly scoped PostgreSQL index and representative
  `EXPLAIN` proof under unrelated delivery history.
- Focused tests, migrations, Web typecheck, lint, privacy review, and ReviewGPT
  review pass.

## Constraints

- Keep `HostedLinqDelivery` as the only durable delivery owner.
- Preserve five-attempt identity semantics, group-aware source digests,
  concurrent terminal receipt ordering, and daily suppression behavior.
- Prefer bounded existence reads and one partial index; add no projection table,
  queue, cache, or duplicate state owner.

## Tasks

1. Ask ReviewGPT for a scoped implementation patch against the exact base.
2. Inspect and apply the patch and migration.
3. Prove query shape and concurrent terminal semantics with unit/PostgreSQL tests.
4. Run focused verification, privacy scan, and exact-head review.

## Verification

- Run the Linq observability store suite, focused PostgreSQL proof, migration
  checks, Web typecheck, and scoped lint.

## Progress

- Implemented the scalar exact-identity/member-day liveness read and the live
  invite-template partial pattern index.
- Focused unit, migration, real-PostgreSQL plan/concurrency, Web typecheck,
  lint, privacy, documentation, and schema guards pass locally.
- The exact-base ReviewGPT implementation artifact completed successfully and
  was inspected before use. The distinct terminal exact-head ReviewGPT gate
  remains pending because this task does not authorize a push or pull request.
