# Bound signup-delivery failure recomputation

Status: completed
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

1. [x] Ask ReviewGPT for a scoped implementation patch against the exact base.
2. [x] Inspect and apply the patch and migration.
3. [x] Prove query shape and concurrent terminal semantics with unit/PostgreSQL tests.
4. [x] Run focused verification, privacy scan, and exact-head review.

## Verification

- Run the Linq observability store suite, focused PostgreSQL proof, migration
  checks, Web typecheck, and scoped lint.

## Progress

- Implemented the scalar exact-identity/member-day liveness read and the live
  invite-template partial pattern index.
- The preliminary database specialist found that the initial PostgreSQL plan
  proof duplicated production SQL. The accepted medium coverage finding was
  fixed by capturing and executing the production `Prisma.Sql` object for both
  exact-identity and member/day-only forms; no production branch or owner was
  added.
- Focused unit, migration, and real-PostgreSQL plan/concurrency verification
  passes 132/132 after the correction and again after the base merge. Web
  typecheck, zero-warning scoped lint, docs drift, privacy, diff, migration,
  architecture, schema, and changelog guards pass.
- Local diff-aware Web verification passes 724 files / 9,705 tests plus lint
  with no errors, development smoke, TypeScript, and production Next build.
- Terminal ReviewGPT round 1 passed on the first-reviewed behavior head. The
  same thread's round 2 fresh full snapshot passed on corrected head
  `bbc6f5f52a4b`, including the production-query capture, bounded index plans,
  cleanup ownership, and current change shape.
- Draft PR #1738 remained draft. Corrected-head CI passed in full. A later
  normal merge from `origin/main` resolved its sole conflict in this docs index
  by preserving both entries; the task-relative ten-file behavior diff stayed
  unchanged, parent final review passed, and exact merge-head CI passed in full.
Completed: 2026-08-12
