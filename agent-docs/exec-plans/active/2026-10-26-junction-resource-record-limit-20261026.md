# Recover bounded Junction resource windows

Status: active
Created: 2026-10-26
Updated: 2026-10-26

## Outcome and invariant

Resource-only hourly-feature imports must recover an oversized day through complete, bounded hours. Keep the collection cap, source admission, canonical import owner, foreground yielding, and durable continuation/retry budgets unchanged. Daily aggregates and oversized individual hours remain fail-closed.

## Evidence and ownership

The existing full reconcile/backfill owner already reduces oversized hourly-feature days. Resource-only closed-day batching does not use that path. Reproduce with the real Junction client and synthetic provider responses before changing source. No open matching PR or current owner was found; prior merged PR3749 explicitly excluded resource-only recovery. This task owns only device-sync provider code and focused tests/docs. Historical production state and unrelated scheduling work are out of scope.

## Approach

1. Prove an overflowing resource day fails on the unchanged candidate.
2. Reuse the existing scalar hour-window coordinate and resource suffix continuation at the current import owner; do not accumulate an entire oversized day or raise limits.
3. Prove complete-hour imports, bounded continuation/restore, preserved completed progress, unchanged daily/hourly failure boundaries, and source/cancellation handling.
4. Focused checks and parent candidate review, then required external non-Claude review and exact-head CI.
5. Coordinate any authorized release and verify exact deployed source. Do not replay or reset the historical failed job.

## Risks

- Partial day authority: allow reduction only for hourly-feature policy, never daily aggregates or recording/session-atomic resources.
- Repeated work: preserve exact first uncommitted hour through the existing scalar payload and retry owner.
- Fanout/memory: keep one resource continuation, existing owner-unit budget and per-collection record cap; no persisted raw rows or vendor cursors.
- Yield/source changes: reuse the existing canonical commit and post-fetch source checks.

## Verification

Unchanged-source proof: the synthetic 25,001-record resource day throws JUNCTION_API_RECORD_LIMIT and ignores an hourly coordinate. Candidate: 78 focused tests pass, including existing full-backfill and historical batching proof; device-sync typecheck passes. Complexity debt remains 314 and maximum remains 95. Review and exact-head CI remain pending. No production writes or replay are part of the proof.

## Product UX

Effort: Patch. Outcome: newly executed oversized hourly-feature history can progress through complete hours. Reaches: existing connected-source resource jobs only. Proof: unchanged-source failure, cold scalar continuation, previously committed days, daily/hourly overflow rejection, foreground yield, and post-fetch source revocation. Walkthrough: Ready for candidate review; no claim that historical production failures were repaired.

## Candidate review

The full source/test diff was reviewed for exact source scope, complete-hour identity, capped in-memory collection, scalar restoration, retained retry budgets, foreground yielding and post-fetch consent. Existing full-job reduction now shares its policy with resource jobs; no new durable field, queue or scheduler was introduced. The single-hour import owner keeps each resource suffix bounded. Earlier complete days are preserved; daily aggregates and oversized hours remain fail-closed.

78 focused provider tests and package typecheck pass. Four production changelog rendering tests pass. Complexity debt stays 314 and maximum 95. PR4377 is the only candidate for this fix; private incident receipts remain outside tracked files and review packages. Implementation and local proof are complete; external review, exact-head CI, coordinated merge/deploy and natural verification remain delivery gates, not completed claims.


## Final review round 1 and remediation

The required GPT-6 Pro review completed on 1166b1adbbc20da327870a73ea2d354a999a661f with one accepted serious finding. The resource manifest did not declare the emitted hourly scalar, so the real service rejected the continuation before durable enqueue. The new composed synthetic test reproduced a dead parent with DEVICE_SYNC_JOB_PAYLOAD_INVALID on the reviewed source.

The correction adds one resource manifest declaration, including the existing hosted-hint flag. The composed test now passes service enqueue, SQLite reopen, provider-aware hint shaping/parse/normalization, a complete-hour import and an exact one-hour cursor advance. Existing unknown-field and typed transport rejection tests remain intact. All 79 focused resource/manifest/transport tests pass. The review did not require a new queue, field, scheduler or wider collection limit.

The reviewed head's five required CI checks passed, including terminal Host Support run40389722184. This source correction requires new exact-head CI and a second substantive full review before final plan closure or merge. Browser ownership is coordinated outside repository artifacts; no production state or historical job is changed.


## Rollout prerequisite

The deployed pre-change resource manifest rejects timeseriesWindowHours during execution as well as enqueue. A new hourly producer can persist state that an older reader cannot execute. The Cloudflare rollout contract requires consumer-first compatibility for this case; immediate rollout alone does not remove the mixed-reader window. Prepare a reader-only prerequisite containing the manifest, complete-hour reader and retained-suffix support, with no oversized-day producer. Verify that fleet has converged before the producer fix is released. Keep PR4377 as the producer candidate and preserve the historical no-replay boundary.


## Resumed correction verification

The corrected source passes 180 focused resource-window, manifest, hosted-hint and hosted-runtime tests plus device-sync typecheck. Complexity remains debt 314 and maximum 95. The producer remains draft while its compatible reader prerequisite is prepared separately. These local results do not establish exact-head CI, final review, deployment or historical recovery.
