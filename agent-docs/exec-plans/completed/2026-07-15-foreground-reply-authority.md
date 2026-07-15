# Foreground reply authority during receipt recovery

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Prevent hosted canonical receipt recovery failures from indefinitely blocking
  a durably accepted current conversation reply.
- Record the foreground reply authority rule in the durable invariants.

## Root cause

- Canonical receipt replay currently runs inside workspace restore, before the
  runtime fetches the conversation mailbox. Any malformed or irreconcilable
  receipt therefore has boot authority and retries forever without allowing the
  current conversation to reach the assistant.

## Constraints

- Reject an unsafe receipt mutation; never force or fabricate canonical state.
- Continue from the restored last-known-good checkpoint and surface one
  secret-safe durable diagnostic for the failed replay batch.
- Add no queue, quarantine store, retry manager, configuration, service, or new
  durable status.
- Keep successful receipts replayable and preserve dirty-domain invalidation.
- Include the ordered audit receipt correction reviewed after PR 669 merged.

## Verification

- Production-shaped hosted runtime regression with a failed receipt and pending
  conversation input.
- Focused core and assistant-runtime tests, owner typechecks and coverage, diff
  hygiene, coverage-write audit, exact-head CI, and ReviewGPT.

## Outcome

- Receipt recovery now rejects and records individual failures, continues later
  valid receipts, preserves cancellation, invalidates affected context, and
  yields foreground authority from the restored authorized state.
- The secret-safe degraded diagnostic is one non-blocking runtime-log attempt;
  a stalled log endpoint cannot become reply authority.
- Added the durable foreground reply authority invariant and the ordered audit
  receipt correction that PR 669 review found after its initial head merged.
- Production adds no durable state, queue, service, retry manager,
  configuration, or compatibility layer. The core remediation deletes five
  more production lines than it adds.
- Coverage-write: no unresolved findings. Focused recovery/cancellation tests:
  2/2 passed. Core focused suite: 42/42 passed. Core coverage: 706/706 passed.
  Assistant-runtime coverage: 1,661 passed, 2 skipped. Owner `test:diff` passed,
  including 1,662 assistant-runtime tests and 1,819 Cloudflare verification
  tests. Both owner typechecks and `git diff --check` passed.
Completed: 2026-07-15
