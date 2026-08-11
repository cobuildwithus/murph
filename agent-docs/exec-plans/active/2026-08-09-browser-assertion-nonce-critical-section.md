# Bound browser assertion nonce database critical sections

Status: active
Created: 2026-08-09
Updated: 2026-08-11

## Goal

Keep hosted browser assertion replay admission to one atomic nonce insert and move
expired nonce reclamation into the existing bounded hourly retention owner, so
browser actions never hold a pooled database connection while sweeping shared
nonce state.

## Success criteria

- Browser assertion admission performs one direct insert, treats only the nonce
  primary-key conflict as a replay, and uses the database clock to fail closed
  if a delayed insert resumes at or after expiry.
- The hourly primary-database cleanup deletes expired browser assertion nonces
  in bounded, ordered, skip-locked batches without delaying unrelated inserts.
- Mixed-version cleanup preserves legacy raw-expiry rows through the verifier's
  former acceptance horizon.
- Focused unit and real-PostgreSQL concurrency coverage proves replay
  convergence, conservative cleanup, bounded work, and lock avoidance.
- Focused verification, exact-head CI, the preliminary specialist pass, and the
  final ReviewGPT gate complete without unresolved accepted findings.

## Scope

- In scope:
  - The hosted browser assertion nonce store.
  - The existing hourly hosted-retention invocation and focused cleanup owner.
  - Direct unit, retention, route, and PostgreSQL contention coverage.
- Out of scope:
  - A deployment compatibility migration or second replay-state owner.
  - Other database locks, schema changes, pool-size changes, or a new scheduler.

## Constraints

- Preserve fail-closed browser assertion authentication.
- Use the nonce primary key as the only replay-convergence owner.
- Preserve legacy rows until `now - 61 seconds` reaches their stored raw expiry;
  new rows may remain conservatively over-retained for the same allowance.
- Keep cleanup serial and bounded to four batches of at most 5,000 rows.
- Reuse the existing hourly retention route; add no queue, advisory lock, schema
  migration, or independent lifecycle owner.

## Tasks

1. [x] Replace request-path sweep-plus-insert transactions with one direct
   insert.
2. [x] Add bounded skip-locked browser nonce cleanup to the hourly retention
   invocation.
3. [x] Add focused unit, retention, route, and PostgreSQL contention coverage.
4. [x] Run focused checks and inspect the exact candidate diff.
5. [x] Commit and push the candidate to draft PR #1486.
6. [ ] Complete exact-head CI, the preliminary specialist pass, and the final
   ReviewGPT gate, then archive this plan.

## Verification

- Focused Vitest suites cover direct nonce admission, retention SQL and batch
  limits, the hourly route result, and runtime-log cleanup ordering.
- An opt-in multi-client PostgreSQL test proves one winner for duplicate nonce
  admission, proves that a locked expired row cannot block a fresh insert, and
  proves that admission resuming after same-nonce retention fails closed while
  restoring the tombstone.
- Web typecheck and focused ESLint, root source hygiene, documentation
  drift/gardening, and diff whitespace checks cover the affected surfaces.

## Decisions

- Keep replay convergence in the existing nonce primary key instead of adding an
  advisory lock or a second read.
- Keep delayed admission fail-closed in the same insert statement with the
  database clock instead of relying on old Web instances to drain before the
  retention owner runs.
- Compare the persisted first-invalid instant strictly greater than the
  millisecond-truncated database clock, because equality is already outside the
  browser assertion acceptance window.
- Keep mixed-version cleanup conservative instead of adding a migration or
  weakening the first-invalid verifier boundary.
- Reuse the existing hourly retention invocation and shared batch ceilings
  instead of adding another scheduler or increasing pool capacity.

## Final review

- Final ReviewGPT rounds 1 and 2 exposed the same theoretical old-cleaner
  rollout seam. The required retrospective found zero production browser nonce
  rows and zero agent sessions, so the incompatible durable state does not
  exist; the review-induced migration, trigger, and backfill were deleted.
- The merge boundary must recheck those aggregate zero-state facts and stop for
  a separately drained cutover if production use begins before promotion.
- Corrected four durable documents that still described the deleted foreground
  cleanup transaction and added the new real-PostgreSQL proof to the canonical
  testing map.
- Kept the focused retention helper local rather than broadening the shared
  cleanup API or introducing another scheduler, queue, lock, or lifecycle owner.
