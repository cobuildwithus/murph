# Bound hosted callback nonce database critical sections

Status: completed
Created: 2026-08-09
Updated: 2026-08-11

## Goal

Keep hosted callback replay admission to one atomic nonce insert and move expired
nonce reclamation into the existing bounded hourly retention owner, so request
handling never holds a pooled connection while sweeping shared nonce state.

## Success criteria

- Callback admission performs one direct nonce insert and treats only the unique
  nonce conflict as a replay.
- The hourly primary-database cleanup deletes expired callback nonces in bounded,
  ordered, skip-locked batches without delaying concurrent callback admission.
- Focused unit, route, and real-PostgreSQL concurrency coverage proves replay
  convergence, strict expiry semantics, bounded cleanup, and lock avoidance.
- Architecture, operations, and testing references describe the same ownership
  and retention contract.
- Focused local verification, exact-head CI, the preliminary specialist pass,
  and the final ReviewGPT gate complete without unresolved accepted findings.

## Scope

- In scope:
  - The shared hosted internal callback nonce store.
  - The existing hourly hosted primary-database retention cleanup and its tests.
  - Direct callback-route regression coverage and durable ownership docs.
- Out of scope:
  - Browser assertion nonce retention, unrelated lock removal, schema changes,
    pool-size changes, or a new cleanup scheduler.

## Constraints

- Preserve fail-closed callback authentication and the existing freshness-skew
  boundary, including acceptance at the exact expiry boundary.
- Use the nonce primary key as the only replay-convergence owner.
- Keep cleanup bounded to four batches of at most 5,000 rows and allow concurrent
  workers to skip rows already locked by another transaction.
- Reuse the existing hourly retention route and shared batch runner; add no new
  queue, process, or lifecycle owner.

## Tasks

1. [x] Replace request-path sweep-plus-insert transactions with one direct insert.
2. [x] Add bounded skip-locked callback nonce cleanup to hosted retention.
3. [x] Add focused unit, route, retention, and real-PostgreSQL contention proof.
4. [x] Align architecture, operations, and testing documentation.
5. [x] Commit and push the exact candidate, open the draft PR, then complete CI
   and both required ReviewGPT gates on exact pushed heads.

## Verification

- Focused Vitest suites cover nonce admission, affected callback routes, hosted
  retention, runtime-log cleanup, and account-data cleanup.
- An opt-in two-client PostgreSQL test proves one winner for duplicate nonce
  admission and proves a locked expired row cannot block a fresh insert.
- Web typecheck and ESLint, root source hygiene, documentation drift/gardening,
  and diff whitespace checks cover the affected repository surfaces.

## Decisions

- Keep replay convergence in the existing nonce primary key instead of adding an
  advisory lock or a second read.
- Use a strict expiry predicate because callback freshness accepts the exact
  expiry boundary.
- Reuse the serial hosted retention owner and its bounded batch primitive instead
  of introducing another cron route or cleanup abstraction.

## Final review

- Final ReviewGPT round 2 passed the exact remediated PR-authored head with no
  qualifying findings after verifying atomic admission, tombstone behavior,
  strict cleanup boundaries, and the added concurrency coverage.
- A single normal merge of current `main` changed only the base history; the
  reviewed PR patch remained unchanged and all required CI passed afterward.
- The parent review found no remaining correctness, security, privacy,
  reliability, or architecture issues in the final patch.
Completed: 2026-08-11
