# Hosted ask continuation round-four remediation

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

Resolve PR #840 ReviewGPT round-three finding by preserving the completion
mailbox occurrence anchor when an Ask materializes before personal input exists,
without restoring an outbox scan or changing the idle workspace snapshot
schedule.

## Success criteria

- The ordinary no-personal-input system-mailbox path materializes every due
  `continue-assistant-ask` completion through the retained-row exact-intent
  reconciliation path.
- A retryable or in-flight Ask intent survives restart with its mailbox ordering
  anchor and is claimed before later personal input.
- The completion executor is not rerun after materialization; replay reuses the
  existing deterministic delivery key.
- The outbox remains the sole owner of retry, confirmation grace, stale-send
  reconciliation, and deliberately parked confirmation-pending behavior.
- Terminal, invalid, missing, or safely parked work releases its anchor; the
  next completion is reconsidered and idle convergence remains intact.
- No queue, scheduler, compatibility scan, private wake calculation, state
  machine, or workspace snapshot trigger is added.

## Constraints

- Keep the mailbox as occurrence/order owner and the outbox as delivery owner.
- Keep the expensive workspace snapshot on the existing idle/shutdown schedule;
  ordinary phase commits must not move or invoke it.
- Preserve unrelated active work and exclude private conversation, health,
  member, and local-machine identifiers from durable artifacts.

## Approach

1. Reproduce the ordinary no-input path from imported completion through
   materialized retry or in-flight restart and later personal input.
2. Reuse the exact retained-row completion lane from ordinary mailbox
   maintenance whenever no personal input is pending, before the generic
   mailbox consumer can remove the row.
3. Keep all exact wake and ambiguous-send decisions delegated to the existing
   outbox owner and delete no further recovery proof.
4. Add production-shaped retryable, sending/restart, parked, terminal, next-row,
   and idle-snapshot regressions.
5. Run scoped and canonical verification, commit and push, then run ReviewGPT
   round four concurrently with exact-head CI.

## Review finding being remediated

- Review-induced High: the round-three removal of the outbox-only fallback was
  correct only if the ordinary no-input mailbox consumer retained the Ask row.
  It did not, so a cross-turn retry or sending restart could lose its ordering
  anchor and be overtaken by later personal input.

## Verification

- Focused no-input completion regressions: 3 passed, including stable-key
  retry/restart, non-idempotent grace-to-park release, and oldest-first empty
  convergence.
- Dirty-window entrypoint regression: 1 passed and explicitly observed the sole
  workspace checkpoint request as `idle_shutdown`.
- Diagnostics harness regressions: 3 passed after adding the system-mailbox
  state seam required by the production read.
- Coverage-write audit: clean after extending terminal replay, stale-send,
  next-row, empty-convergence, and idle-snapshot proof.
- `pnpm test:diff packages/assistant-runtime`: passed (Assistant Runtime 1,805
  passed, 2 skipped; Cloudflare Node 1,851 passed; Workers 1 passed), including
  typechecks, builds, boundary checks, and repository guards.
- `pnpm verify:acceptance`: passed, including package coverage, package
  boundaries, 6,125 web tests passed with 150 skipped, app verification, and
  the production web build.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- Added-line and plan privacy scans: passed with no private conversation,
  health, member, or local-machine identifiers introduced.
Completed: 2026-07-22
