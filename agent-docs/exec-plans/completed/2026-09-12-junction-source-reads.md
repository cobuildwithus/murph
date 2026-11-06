# Reduce empty Junction reconciliation source reads

Status: completed
Created: 2026-09-12

## Outcome and invariant

Reduce redundant hosted source snapshot reads during bounded daily reconciliation.
Preserve fresh source authority before nonempty imports and before returning any
progress from empty lifecycle-fenced windows. Preserve authoritative empty-day
replacement, scoped backfill completion, cancellation, retries, and queue bounds.

## Evidence and design

The full-job owner already batches at most 16 same-resource units over five
seconds. Empty lifecycle-fenced windows still read sources individually although
they perform no canonical import. For unscoped reconcile batches only, defer
those reads to one fresh lifecycle check before returning the batch result.
Nonempty imports and other job owners retain their existing reads.

The existing provider executor owns the change. The only additional state is
invocation-local pending-check state; no cache, TTL, persisted format, dependency,
endpoint, or deployment-order requirement is introduced. Failed final validation
throws the existing retryable error and publishes no batch result.

## Verification and completion

- Add a failing read-count regression using actual provider execution.
- Cover reconnect, missing source, unavailable source reads, nonempty import
  authority, bounded yield/restart, and unchanged backfill behavior.
- Run focused provider tests, device-syncd typecheck, and complexity validation.
- Update the reliability owner; inspect the complete diff and privacy.
- Complete required candidate review, scoped commit, PR CI, and final ReviewGPT.
- Production savings require a later runtime rollout and measured traffic.

## Progress

- Implementation and parent review complete. One private post-fetch source
  reader keeps canonical import authority explicit; the existing bounded batch
  owns only a pending lifecycle fence for empty unscoped reconciliation.
- Before implementation, the seven-window and three-window regressions failed
  with seven and three reads. They now use one read each. Mixed input retains
  fresh import checks; nonempty-only input adds no request.
- Focused provider suite passed 173 tests across five files. After adding the
  bounded-prefix resume case, all 14 focused request regressions passed.
- Device-syncd typecheck passed on the final source and tests. Scenario integrity
  passed for 205 scenarios, 12 sample inputs, and 29 golden-output directories.
- Complexity guard passed: file debt 329 to 326, maximum unchanged at 96.
  The changed batch remains at 23 and the timeseries import at 21; their branches
  retain explicit cancellation, bounded continuation, and canonical admission.
- Diff and authored-artifact privacy inspection passed. No new tooling friction.
- Internal request optimization only: no assistant input or user interface
  changes, no public changelog claim, and no live-model verification required.
- Required exact-head CI and final ReviewGPT remain tracked by the task PR.
  This record does not claim deployment or measured production savings.
Updated: 2026-09-12
Completed: 2026-09-12
