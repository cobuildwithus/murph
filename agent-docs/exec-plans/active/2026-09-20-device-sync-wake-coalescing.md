# Reduce redundant device history and reconcile wakes

Status: active
Created: 2026-09-20
Updated: 2026-09-20

## Outcome and protected invariants

Reduce redundant background invocations while preserving incoming updates and
an independent hourly pull floor. Keep canonical writes in core and preserve
source lifecycle, connection generation, checkpoint and queue ownership.

Outcome: fewer separate scheduled wakes and less repeated empty history work.
Reaches: hosted webhook sync, legacy empty weight retries, new history scans,
source reconnects, and provider pulls that complete while a scan is underway.
Proof: durable job convergence retains the union of accepted windows; bounded
30-day weight reads retain late data; an active webhook pass performs a nearby
full reconciliation instead of claiming a partial import refreshed its proof.

## Evidence and design

- Earlier history scheduling uses stable source/lifecycle/generation keys, but
  accepted legacy retry roots retain window-specific keys. Normalize only empty
  weight roots at their full-history boundary through the queue transaction.
  Merge queued roots by the union of their windows. Running jobs, partial scans,
  unresolved evidence, and older generations keep their existing owners.
- Weight uses sparse exact readings yet inherits one-day fetch chunks. Use the
  existing bounded chunk mechanism with 30-day windows; retain pagination,
  signal handling, source admission and pending-start coverage fences. Junction's
  documented body-weight endpoint accepts datetime bounds and paginated reads.
- Hosted webhook passes explicitly skip ordinary scheduling. When actual dirty
  work is admitted, coalesce a full pull due within thirty minutes into the
  already active pass. Existing durable jobs own execution, retry and proof;
  no webhook receipt alone can refresh a complete content proof.

## State, failure and deploy skew

No new persisted fields, tables or wire schema. Queue roots keep the full union
of accepted history. Old runtime versions can consume the same retained jobs;
only optimization is lost on downgrade. Checkpoint and auth gates remain intact.
Hourly Web preflight and genuine data changes continue to wake when necessary.
This changes the timing of a full pull, not the maximum allowed recovery gap.

## Tasks

1. Implement queue convergence, bounded weight chunks and active-pass scheduling.
2. Prove late history, partial/running work, lifecycle isolation and cadence gates.
3. Update durable contracts and public changelog; focused tests and typechecks.
4. Parent review, exact-head CI and ReviewGPT, then authorized merge/deploy.
5. Verify deployed revisions and inspect bounded production outcomes.
