# Junction Temporal Features Round 5 Retrospective

Status: completed decision record for PR #1703 ReviewGPT round 5 remediation.

## Original requirement

Existing Junction sync should make bounded, trustworthy within-day oxygen and
stress patterns queryable without retaining raw timelines or requiring a new
member action. Temporal replacement authority belongs to a fully closed
vault-local day after the arrival lag. Ordinary Junction date-mode resources
must retain their provider-calendar-day request and ownership semantics.

## Shape and recurrence

- Immutable first-reviewed head:
  `33cdb72da0a96aeba872d448002c1924040b6d53`.
- Round 5 reviewed head:
  `ef17981cf97ae9ff80727c755aa27082eb96ec31`.
- Exact candidate when round 5 completed:
  `f1ce48dc53f643a2cf706dd39291e83bac30222e`.
- Authored production-source churn grew from 599 lines at the first-reviewed
  head to 2,069 lines on the current stacked-base patch. The growth established
  vault-local authority, bounded reducers, canonical replacement, hosted
  timezone forwarding, and durable historical recovery.
- The round 5 continuation finding is review-induced. The prior remediation
  combined two individually valid recovery primitives in one provider result:
  same-row continuation and scheduled child jobs. The production service
  intentionally rejects that mutually exclusive combination before its atomic
  completion-and-enqueue transaction.
- The round 5 ordinary-window finding is original-PR purpose drift. A shared
  local-day builder crossed the temporal boundary and re-partitioned every
  ordinary date-mode resource. Formatting those local instants as dates can
  overlap provider calendar dates, and a one-day non-UTC reconcile can collect
  no ordinary resource at all.

## Evidence and accepted findings

1. **Mutually exclusive continuation owners — accepted.** The Junction
   provider regression returns both `jobContinuation` and `scheduledJobs` after
   cooperative yield. `DeviceSyncService` rejects that exact shape with
   `DEVICE_SYNC_JOB_CONTINUATION_INVALID`, so none of the promised recovery work
   reaches the atomic enqueue transaction.
2. **Ordinary date-mode ownership drift — accepted.** A Los Angeles local-day
   interval formats as two distinct provider dates, while adjacent local days
   repeat one of those dates. The former provider-calendar builder issued one
   identical start/end date per request and admitted a one-day reconcile.

## Decision

Continue this PR with an owner-boundary correction and net conceptual deletion:

1. Restore provider-calendar daily windows for every non-temporal date-mode
   path. Keep vault-local adjacent-midnight windows only for temporal resources
   fetched with exact datetime bounds.
2. Return exactly one continuation representation. If temporal child jobs are
   scheduled, complete the parent and enqueue at most one existing reconcile
   follow-up for the first still-unhandled ordinary coordinate. Advance past
   temporal coordinates delegated to child jobs. Preserve same-row continuation
   only when no parallel job is scheduled.
3. Keep the existing device-job queue/history, same-row continuation primitive,
   service transaction, canonical authoritative facets, and member-edit fence.
   Add no table, cursor owner, queue, state machine, lifecycle service, or
   compatibility path.
4. Preserve the 1–14 day temporal horizon and existing provider/page/import
   ceilings. This correction changes ownership selection, not admitted load.

## Required proof

- Compose the real Junction provider through `DeviceSyncService` and its store.
  Force yield after one temporal resource and prove the parent never fails with
  `DEVICE_SYNC_JOB_CONTINUATION_INVALID`, temporal child jobs and the ordinary
  follow-up commit atomically, restart retains them, and handled temporal work
  is not fetched twice.
- Cover one-day and fourteen-day horizons, successful-empty temporal authority,
  retryable/optional failures, lease release, and member-edit fencing through
  the existing focused suites.
- In UTC, America/Los_Angeles, and Asia/Tokyo, prove ordinary resources issue
  one non-overlapping provider date per request at horizons 1, 7, and 14, while
  temporal resources retain exact vault-local bounds and the 24-hour authority
  lag.
- Re-run the focused provider, service, store, importer, hosted-runtime, bundle,
  and affected-package typecheck lanes before the next exact-head ReviewGPT
  round.
