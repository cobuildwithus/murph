# Junction Temporal Features Round 7 Cap Retrospective

Status: completed decision record for PR #1703 ReviewGPT round 7 remediation
and the seven-round cap.

## Original requirement

Existing Junction sync should make bounded, trustworthy within-day oxygen and
stress patterns queryable without retaining raw timelines or requiring a new
member action. Temporal replacement authority belongs only to fully closed
vault-local days. The existing scheduled pull remains an unconditional floor
for ordinary Junction resources regardless of webhook activity.

## Recurrence and root cause

- The first-reviewed patch used the account-wide `lastSyncCompletedAt` timestamp
  to skip ordinary timeseries when any successful job had completed in the
  current authoritative vault day.
- Round 6 found one consequence: higher-priority temporal children could advance
  that generic timestamp before the queued ordinary reconcile follow-up ran.
  The remediation correctly prevented temporal children from mutating it.
- Round 7 exposed the broader original ownership error. An ordinary webhook or
  direct resource job can also advance the generic timestamp after importing or
  fetching only one resource. A later scheduled reconcile then mistakes partial
  account activity for proof that the complete ordinary pull floor finished and
  silently skips every configured ordinary timeseries resource.
- The repeated mechanism is therefore not a missing job-kind exception. It is
  the unsafe assumption that a generic account activity timestamp can certify
  complete ordinary-floor coverage.

## Shape and cap decision

- The immutable first-reviewed head contained 599 authored-source lines of
  churn. The round-7 candidate contains 2,171 authored-source lines of churn
  before this correction. Review growth primarily added temporal authority,
  durable catch-up, continuation, provider-calendar, and priority-order proof.
- The temporal feature remains indivisible because collection, replacement
  authority, compact normalization, and query projection implement one
  user-visible promise. This cap review does not justify splitting ownership or
  adding another lifecycle.
- Delete the same-authoritative-day ordinary-timeseries skip. The repository's
  ingestion invariants already require push and pull to remain additive, the
  scheduled pull to run unconditionally, and push-then-pull overlap to converge
  through existing idempotent identities. No demonstrated load requirement
  justifies the skip.
- Keep `lastSyncCompletedAt` as generic account activity state. It does not
  certify complete-resource or complete-floor coverage. Add no new persisted
  marker, job-kind exception, queue, state machine, or completion owner.
- Retain the existing temporal-authority rule: temporal child jobs do not update
  generic completion, so they cannot consume or misrepresent the parent or
  ordinary follow-up's lifecycle.

## Required proof before a continuation decision

- A production-composed service and SQLite regression configures a nonempty
  ordinary timeseries resource, drains a priority-65 ordinary webhook before a
  priority-40 scheduled reconcile, and proves the reconcile still fetches every
  expected provider date.
- The proof covers UTC, America/Los_Angeles, and Asia/Tokyo authority boundaries,
  survives restart, and converges without duplicate canonical output.
- Existing temporal restart, priority-order, successful-empty, retry, yield,
  timezone, provider-calendar, and 29-row ceiling proofs remain green.
- After the accepted round-seven fix is pushed, the ReviewGPT loop pauses. Round
  eight requires an explicit informed continuation decision and must return a
  later exact-head `PASS` before merge.
