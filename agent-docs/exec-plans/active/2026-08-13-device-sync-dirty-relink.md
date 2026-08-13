# Relink retained device-sync dirty ownership

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Prevent a cold-restored device-sync job from losing the Web dirty-payload
  acknowledgement relationship needed to complete its existing obligation.

## Success criteria

- Dirty rows matching existing queued or running jobs rebuild their local
  acknowledgement links without consuming new admission slots.
- Only genuinely new job identities count against the 100-job pass limit.
- A full retained 100-job page can cold-restore, finish, and acknowledge all
  represented Web dirty rows without replaying work or resetting attempts.
- Multiple dirty rows sharing one pending job all reach terminal acknowledgement.
- Focused tests, typecheck, exact-head CI, and routed ReviewGPT gates pass.

## Scope

- In scope: hosted assistant-runtime dirty admission, existing job identity
  matching, focused cold-restore and cardinality tests.
- Out of scope: new durable state, schema changes, queues, schedulers, provider
  retry policy, or changes to Web dirty-row ownership.

## Tasks

1. [completed] Reproduce the cold-restore acknowledgement-link loss.
2. [completed] Relink matching existing pending jobs and bound only new work.
3. [completed] Add maximum-cardinality, mixed-set, and shared-dedupe coverage.
4. [in_progress] Run focused verification, ReviewGPT, CI, merge, and deploy.

## Decisions

- Reuse the account-scoped pending-job read already required for admission.
- Match the same account, provider, and dedupe identity as the device-sync store.
- Keep Web dirty rows and the encrypted mailbox as the only durable owners;
  SQLite remains an execution cache.

## Verification evidence

- The maximum-cardinality cold-restore regression failed before the source fix
  because no dirty acknowledgement links were rebuilt, then passed after it.
- The full hosted device-sync runtime suite passed: 99 tests.
- The hosted runtime maintenance suite passed: 82 tests.
- The assistant-runtime typecheck passed.
- Preliminary ReviewGPT questioned relinking an expired, exhausted generic
  running job. A final-gate review proved replacement would reset retry
  authority and could replay an ambiguous provider effect, so the replacement
  machinery was deleted. The existing job identity remains the terminal owner.
- A focused regression proves the stale identity and exhausted attempt count
  remain intact, the provider executor is not invoked again, and the existing
  claim/dead-letter owner terminally acknowledges the linked dirty row.
- Post-remediation proof passed: 100 assistant-runtime tests, 82 maintenance
  tests, 47 device-sync store tests, and both package typechecks.
