# Junction Temporal Features Round 6 Retrospective

Status: completed decision record for PR #1703 ReviewGPT round 6 remediation.

## Original requirement

Existing Junction sync should make bounded, trustworthy within-day oxygen and
stress patterns queryable without retaining raw timelines or requiring a new
member action. Temporal replacement authority belongs to fully closed
vault-local days, while ordinary date-mode resources retain provider-calendar
ownership and must finish before the account records generic reconcile
completion.

## Recurrence and root cause

- Round 5 correctly replaced one invalid provider result containing both a
  same-row continuation and scheduled jobs with temporal children plus one
  durable ordinary reconcile follow-up.
- The round 6 finding is review-induced downstream ownership drift. Temporal
  resource children have higher priority than the ordinary follow-up and used
  the service's default generic-success behavior.
- The first successful or stale-timezone temporal child could therefore advance
  `lastSyncCompletedAt`. The later ordinary follow-up would then apply the
  same-day optimization, exclude every ordinary resource, and consume its
  cursor without fetching it.
- Queue persistence was proven, but execution-order composition was not drained
  after restart. The missing proof stopped at durable rows instead of proving
  the retained ordinary owner still admitted its work after higher-priority
  children completed.

## Decision

1. Temporal-authority resource jobs never advance generic account completion,
   including successful-empty imports and stale-timezone no-ops. Reuse the
   existing `updatesLastSyncCompletedAt: false` result flag.
2. Keep the parent or queued ordinary reconcile follow-up as the only owner that
   may advance generic completion for this split. Add no new state, queue,
   cursor, transaction, or lifecycle abstraction.
3. Extend the production-composed restart regression to drain the persisted
   rows in real priority order. Temporal children must run first without
   advancing completion; the ordinary follow-up must then fetch its equal-date
   provider windows and become the completion owner.
4. Keep the temporal horizon at fourteen days. The worst queued shape is 28
   temporal resource/day jobs plus at most one existing ordinary reconcile
   follow-up, for 29 serialized rows. Provider page, retry, record, and import
   ceilings remain unchanged.

## Required proof

- Successful-empty temporal authority and stale-timezone no-op results both
  suppress generic completion.
- A restarted real service drains temporal jobs before the ordinary follow-up,
  leaves `lastSyncCompletedAt` unchanged during temporal work, fetches every
  retained ordinary provider date, and advances completion only after that
  follow-up succeeds.
- The handled newest blood-oxygen coordinate is not duplicated, all queued rows
  remain serialized by the existing per-account fence, and the focused provider,
  service, importer, hosted-runtime, bundle, and typecheck lanes remain green.
