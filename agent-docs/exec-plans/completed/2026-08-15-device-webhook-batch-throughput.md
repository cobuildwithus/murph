# device-webhook-batch-throughput

Status: completed
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Increase encrypted device-webhook storm throughput by replacing serial Web
  admission with larger transport callbacks and bounded account-safe
  parallelism, while preserving exact at-least-once processing and acquiring
  database authority only for work that is actually starting.

## Success criteria

- A modeled 10x historical connection storm (26,750 events over five minutes)
  drains materially faster than the current one-event-at-a-time Web path.
- Exact resource events are never dropped or coalesced; only accepted or proven
  duplicate entries are acknowledged to Cloudflare Queues.
- Work for one provider account retains the ordering and authority guarantees
  required by the existing device-ingress owner, while independent accounts can
  make bounded progress concurrently.
- Database work keeps the existing per-event lease and durable-write owner;
  callback termination cannot leave future same-account events preclaimed.
- Value-free metrics expose batch size, account-lane count, outcomes, retry
  causes, and duration without payloads or direct identifiers.
- Focused scheduler/transport tests, typechecks, ReviewGPT gates, and exact-head
  CI pass.

## Scope

- In scope: Cloudflare Queue consumer batching, signed Web admission, shared
  device-ingress scalar ownership, value-free observability, focused
  load/concurrency proof, and operations documentation.
- Out of scope: provider payload coalescing, relaxed consent or provider
  authority checks, schema changes without a proven need, foreground sync
  degradation, or removing the existing retry/DLQ safety net.

## Evidence

- A historical connection burst produced 2,675 webhook traces in five minutes
  across three newly connected accounts; one account produced 1,745 events.
- The requested 10x model is 26,750 events over five minutes (about 89/s on
  average, with a peak minute near 222/s), below Cloudflare Queue ingress and
  batch limits.
- Cloudflare already delivers the maximum 100 messages per consumer batch, but
  Web currently splits those into groups of 25 and serially calls the shared
  ingress handler once per event. Transport batching therefore does not batch
  the dominant database work.
- At one serial event every 200 ms, the 10x burst takes roughly 89 minutes to
  drain; at 500 ms it takes roughly 3.7 hours.

## Constraints

- Preserve provider signature verification, encrypted Queue envelopes, frozen
  provider-auth evidence, trace idempotency, consent checks, provider-app
  revision checks, source setup, dirty-state marking, durable exact work, wake
  ownership, retry bounds, and DLQ recovery.
- Keep transaction cardinality and concurrency explicitly bounded at the
  measured maximum batch size.
- Maintain compatibility during independent Web and Worker rollout; do not
  enable additional provider traffic as part of this change.

## Tasks

1. Have ReviewGPT inspect the current owners, propose the smallest architecture,
   and return a compilable implementation patch with tests.
2. Integrate the patch, preserving account ordering and existing ingress
   invariants while adding bounded cross-account parallelism and retaining a
   batch database primitive only if its recovery contract is production-safe.
3. Add value-free batch observability and update the hosted control-plane docs.
4. Run focused unit/integration tests, a deterministic maximum-callback proof,
   the 10x modeled drain calculation, and touched-package typechecks.
5. Push the exact candidate, run the preliminary specialist and final ReviewGPT
   gates concurrently with CI, resolve findings, and land only a green head.

## Decisions

- Keep Cloudflare consumer concurrency at one initially. Parallelism is owned by
  the bounded admission batch so the database load ceiling is explicit and one
  Worker invocation cannot multiply it unexpectedly.
- Preserve all exact resource work. The optimization target is redundant
  transaction/setup overhead and independent-account scheduling, not semantic
  event reduction.
- Prefer extending the shared device-ingress owner over creating a second
  webhook processor or database source of truth.
- Accepted ReviewGPT's provider-account lane boundary, four-lane ceiling, and
  recommendation to keep durable payload commits independent. Rejected its
  first artifact as incomplete because it added no database batching or tests.
- Rejected ReviewGPT's replacement artifact as written because it was malformed
  and classified new and expired trace rows without proving claim-token
  ownership or performing the stale takeover. Implemented the proposed batch
  seam at the existing owner with matching singular-claim semantics and real
  PostgreSQL proof.
- ReviewGPT correctly identified that claiming eight traces before serial
  same-account processing could leave as many as 28 not-yet-started events
  holding five-minute leases after callback termination. Delete that cross-event
  claim path, the optional store API, its Prisma implementation, and the chunk
  concept. Each lane now acquires one trace lease only when that exact event
  starts; consent, current provider/source authority, encrypted dirty payloads,
  trace completion, wakes, and post-commit signaling remain independently
  retryable per event.
- Use 100 as the callback count ceiling, but partition dynamically when the
  exact UTF-8 body would exceed 2 MiB. This preserves the common one-callback
  path without making maximum-size valid events fail Web parsing.
- Preserve non-overlap and input-order attempt starts within one account. As in
  the base path, a later event may be durably accepted after an earlier attempt
  returns retry. The observed peak was concentrated (about 65% in one account),
  so the conservative 10x lower-bound model is roughly 58 minutes at 200
  ms/event or 2.4 hours at 500 ms/event. A hypothetical evenly loaded
  four-account burst approaches 22 and 56 minutes, respectively.
- Accepted the preliminary telemetry finding and retained direct value-free Web
  and Worker marker-exclusion tests. Withdrew the claimed composed PostgreSQL
  proof after final ReviewGPT showed that its empty registry exercised only
  trace claim/completion, not the registered-provider durable path.
- ReviewGPT round 3 verified the retrospective deletion and production code
  invariants, then found stale rollout/reliability prose and missing direct
  compatibility proof. The correction records Web-before-Worker version skew,
  updates the canonical 100-entry/four-lane contract, proves Web accepts both
  25 and 100 entries while rejecting 101, and proves a non-success Web response
  retries every exact Queue message without acknowledgement.
- ReviewGPT round 4 reviewed the complete corrected snapshot at `37083864` for
  32 minutes 38 seconds and returned `ROUND_OUTCOME: PASS` with no findings. It
  explicitly verified the rollout, lease, attempt-order, retry, byte-limit,
  privacy, and bounded-concurrency corrections. The review ran through
  ReviewGPT 0.5.131 on Pro; its post-submit attachment-tile verifier failed, but
  the persisted exact turn and final file-specific analysis proved the current
  ZIP was readable without resending the request.

## ReviewGPT retrospective

- Original requirement: shorten the 26,750-event modeled storm while preserving
  exact retry, ordering, authority, and durable acceptance.
- First-reviewed head `d7bd47c8` had 507 authored-source churn lines. The
  pre-retrospective head `b38abd97` had 508, so review remediation added one net
  source line while concentrating growth in tests and documentation.
- Concepts at the first head: 100-entry callbacks, exact byte partitioning,
  four provider-account lanes, eight-entry trace-claim chunks, five-minute
  processing leases, per-event durable work, and aggregate telemetry.
- Decision: delete the chunk and cross-event batch-claim concepts rather than
  add a lease type, refresh path, cancellation reconciliation, or another state
  owner. Retain 100-entry callbacks, exact byte partitioning, one Cloudflare
  consumer, four independent account lanes, same-account serial order,
  per-event leases, and aggregate telemetry.
- Requirement tradeoff: the safe gain is fewer Vercel callbacks plus progress
  across independent accounts. Same-account database work remains scalar
  because its authority, encrypted writes, locks, trace completion, and wake
  effects are independently retryable and cannot safely share one future-work
  lease or rollback boundary.

## Verification

- Focused Web batch, signed-route, and scalar trace-store tests: 7, 5, and 4
  passed. Coverage retains 100-entry same-account input-order attempt starts,
  four active account lanes, input-order results, per-event deadline retention,
  sibling failure isolation, and cross-account failure isolation.
- Signed Web route tests: 5 passed, directly covering compatible 25- and
  100-entry callbacks, the four-lane bound, and 101-entry rejection.
- Shared device ingress returned to its existing scalar owner; all 80 focused
  tests passed after removal of the cross-event claim API.
- Cloudflare Worker: 12 focused tests passed, including one ordinary 100-entry
  callback, exact 2 MiB body partitioning, independent dispositions, whole-
  callback non-success retry, and explicit success/failure telemetry privacy
  assertions.
- Hosted transport package: 7 focused tests passed.
- Web, device-syncd, Cloudflare Worker, and hosted-control typechecks passed.
- ReviewGPT was updated from 0.5.127 to 0.5.131. Frozen-lockfile installation,
  CLI version output, and the focused release-contract test passed.
- Preliminary ReviewGPT returned two coverage findings. The telemetry finding
  is resolved. The maximum-cardinality finding led first to an inadequate
  trace-only proof and then to this retrospective deletion of future-work trace
  batching. Round 3 returned documentation and direct-proof findings after
  verifying the corrected production path; those findings are resolved. Round
  4 returned `PASS` with no findings on the exact pushed correction head.
Completed: 2026-08-15
