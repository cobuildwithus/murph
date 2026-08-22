# Junction Temporal Features Round 8 Retrospective

Status: completed decision record for PR #1703 ReviewGPT round 8 remediation.

## Original requirement

Existing Junction sync should make bounded, trustworthy within-day oxygen and
stress patterns queryable without retaining raw timelines or requiring a new
member action. Temporal replacement authority belongs only to fully closed
vault-local days. The scheduled reconcile must remain able to discover current
provider data after source or provider availability changes.

## Recurrence and root cause

- Round 7 removed a generic account-completion shortcut because a narrow
  webhook import could suppress the wider scheduled ordinary-resource pull.
- Round 8 found the same completion-proof error inside temporal history. A
  stable resource/day dedupe key made any succeeded temporal child terminal
  across later scheduled reconciles.
- The child fetch reads the Junction account's current connected-source roster,
  so its data domain can widen after source admission or reconnect. Provider
  history that was empty can also become available later. The stable key did
  not bind either source topology or data availability.
- A succeeded row therefore proved only that one prior attempt completed. It
  could not prove that the same day remained complete for every future
  scheduled reconcile. Treating it as permanent authority left older days
  stale until they aged out of the bounded horizon.
- The repeated mechanism is a narrower completion signal suppressing a wider
  pull owner. The account timestamp in round 7 and the succeeded child row in
  round 8 were different representations of the same ownership mistake.

## Shape and decision

- The round-8 reviewed patch contains 1,839 authored production-source lines
  of churn. The feature remains one indivisible member-visible promise across
  bounded collection, replacement authority, compact normalization, and query
  projection.
- Delete succeeded-row suppression from queue deduplication. A temporal
  resource/day job is duplicate only while an equivalent row is queued or
  running. Succeeded rows remain durable history for observability, not current
  authority proof.
- Keep the scheduled reconcile as the current temporal-coverage owner. It may
  enqueue the same bounded older resource/day coordinates again on its next
  cadence, where canonical authoritative replacement converges populated,
  empty, and unchanged results.
- Add no source generation, topology fingerprint, completion table, queue,
  state machine, or lifecycle abstraction. Such state would recreate an
  invalid permanent-completion claim around provider data that can change.
- The per-reconcile ceiling remains 28 temporal rows plus at most one ordinary
  continuation, serialized by the existing per-account fence. This correction
  intentionally permits that bounded work on later reconcile cadences; provider
  page, record, retry, import, and fourteen-day horizon ceilings are unchanged.

## Required proof before another review round

- A store regression proves queued and running temporal work still deduplicates,
  while a succeeded temporal row can be enqueued again after restart.
- A production-composed service regression completes an empty older day, then
  changes current provider availability and proves a later scheduled reconcile
  refetches and imports that same day.
- The same production-composed path proves a newly admitted or reconnected
  source participates in the repeated historical fetch rather than inheriting
  the prior source roster's completion.
- Existing successful-empty replacement, restart ordering, retry, yield,
  timezone, provider-calendar, priority, ordinary-floor, and maximum-row proofs
  remain green.
- After remediation and exact-head green CI, the ReviewGPT loop pauses again.
  Round 9 requires a new explicit informed continuation decision and must
  return an exact-head `PASS` before merge.
