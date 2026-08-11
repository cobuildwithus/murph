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
- A migration-first database normalizer preserves every old and current
  writer's nonce row through the verifier's first-invalid horizon.
- Focused unit and real-PostgreSQL concurrency coverage proves replay
  convergence, conservative cleanup, bounded work, and lock avoidance.
- Focused verification, exact-head CI, the preliminary specialist pass, and the
  final ReviewGPT gate complete without unresolved accepted findings.

## Scope

- In scope:
  - The hosted browser assertion nonce store.
  - The nonce expiry-normalization migration and compatibility proof.
  - The existing hourly hosted-retention invocation and focused cleanup owner.
  - Direct unit, retention, route, and PostgreSQL contention coverage.
- Out of scope:
  - Other database locks, schema changes, pool-size changes, or a new scheduler.

## Constraints

- Preserve fail-closed browser assertion authentication.
- Use the nonce primary key as the only replay-convergence owner.
- Keep old and current writers submitting the raw signed `exp`; the database
  alone adds the shared 61-second offset so no writer can double-normalize it.
- Preserve normalized rows until `now - 61 seconds` reaches their stored
  first-invalid expiry.
- Keep cleanup serial and bounded to four batches of at most 5,000 rows.
- Reuse the existing hourly retention route; add no queue, advisory lock, schema
  independent lifecycle owner, or rollout pause.

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
- Install the expiry normalizer before the replacement Web deployment and
  backfill existing rows in the same migration transaction. Old inserts before
  commit are backfilled; old and current inserts after commit pass through the
  same trigger. This closes the old-cleaner overlap without a rollout pause,
  second state owner, or weaker verifier boundary.
- Reuse the existing hourly retention invocation and shared batch ceilings
  instead of adding another scheduler or increasing pool capacity.

## Final review

- The first final ReviewGPT pass caught that an old Web cleaner could delete a
  raw-expiry row during the new verifier's extra acceptance minute. The
  migration-first normalizer and PostgreSQL old-writer/old-cleaner replay proof
  close that mixed-version gap.
- Corrected four durable documents that still described the deleted foreground
  cleanup transaction and added the new real-PostgreSQL proof to the canonical
  testing map.
- Kept the focused retention helper local rather than broadening the shared
  cleanup API or introducing another scheduler, queue, lock, or lifecycle owner.
