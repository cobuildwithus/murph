# Junction Temporal Features Round 9 Retrospective

Status: completed decision record for PR #1703 ReviewGPT round 9 remediation.

## Original requirement

Existing Junction sync should make bounded, trustworthy within-day oxygen and
stress patterns queryable without retaining raw timelines or requiring a new
member action. Ordinary daily blood-oxygen and stress facts keep their existing
pull/backfill owner, timing, history depth, and identity. Temporal replacement
authority belongs only to fully closed vault-local days and governs only the
new compact temporal facets.

## Recurrence and root cause

- Round 8 found a succeeded temporal child row acting as permanent completion
  proof, suppressing the wider scheduled pull owner after source or
  provider-data widening. The accepted correction deleted succeeded-row reuse
  from queue deduplication.
- Round 9 found the same ownership mistake one level higher, plus the growth
  cost of the round-8 deletion:
  1. Temporal closure authority, needed only to decide when temporal facets are
     safe to emit, took over ordinary ingestion for `blood_oxygen` and
     `stress_level`. Both full-job scheduling paths exclude the two temporal
     resources from the ordinary timeseries pull, so their base daily facts
     inherit the 24-hour closure lag and the reconcile-derived horizon instead
     of the ordinary pull floor and 14-day backfill window. The ordinary
     aggregation path also reinterprets implicit `+00:00` timestamps through the
     temporal resolver, changing ordinary day ownership and identity.
  2. With succeeded-row reuse deleted, every scheduled reconcile enqueues the
     same bounded resource/day coordinates again, and each completed attempt
     leaves a new terminal `device_job` row forever. No retention owner exists,
     so healthy accounts accumulate unbounded terminal history.
- The repeated mechanism is a narrower authority making decisions for a wider
  owner: in round 8 a narrow completion signal suppressed the wider pull owner;
  in round 9 the narrow temporal-facet authority replaced the wider ordinary
  ingestion owner outright.

## Shape and decision

- One ordinary-fact owner: the existing unconditional ordinary pull/backfill
  path again owns ordinary daily blood-oxygen and stress facts. Delete the
  temporal-resource exclusion from both full-job timeseries scheduling sites so
  the two resources flow through ordinary UTC provider-calendar requests with
  the ordinary 14-day backfill window and existing timing. The exclusion is
  removed unconditionally, so custom importers without a timezone resolver also
  regain ordinary coverage.
- One temporal-facet authority: the temporal lane keeps its exact vault-local
  closed-day windows, 24-hour lag, newest-day-inline scheduling, and bounded
  older-day jobs, and continues to be the only path that can emit or
  authoritatively replace temporal facets. Ordinary imports of the two
  resources produce ordinary facts only and receive no temporal authority.
- Ordinary identity is not migrated: delete the temporal timestamp
  reinterpretation from the ordinary daily aggregation branch. Vault-local
  interpretation of implicit `+00:00` timestamps remains only inside temporal
  facet derivation. No ordinary external reference, day ownership, or aggregate
  value changes.
- Terminal attempt history is not a product requirement: bound it inside the
  existing `device_job` owner. When a temporal resource/day child is enqueued
  and no queued or running row exists, prior terminal rows for the same
  account/provider dedupe coordinate are deleted before insert. Retained
  terminal cardinality is deterministically bounded by the horizon (at most one
  terminal row per coordinate, 28 across both resources at the 14-day maximum)
  while queued/running deduplication and post-widening refetch semantics from
  round 8 are unchanged.
- Add no completion ledger, coverage table, topology fingerprint, cleanup
  service, second scheduler, or new lifecycle owner.

## Required proof before another review round

- A production-composed regression with default configuration, a vault
  timezone, no webhook, and 14 days of provider data proves every ordinary
  daily fact becomes queryable on the ordinary schedule, the newest closed
  ordinary day is not delayed by temporal authority, and temporal facets appear
  only after their closed-day rule is satisfied.
- Ordinary `+00:00` identity regressions prove day ownership, external
  references, and aggregate values match base behavior for the two temporal
  resources.
- A store regression proves repeated reconcile cadences keep terminal
  `device_job` cardinality deterministically bounded while queued and running
  duplicates still converge and a previously succeeded coordinate is refetched
  after restart and source widening.
- Existing successful-empty replacement, restart ordering, retry, yield,
  timezone, provider-calendar, priority, and ordinary-floor proofs remain
  green.
- After remediation and exact-head green CI, the ReviewGPT loop pauses again.
  Round 10 requires a new explicit informed continuation decision and must
  return an exact-head `PASS` before merge.
