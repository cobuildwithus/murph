# device-webhook-batch-throughput

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Increase encrypted device-webhook storm throughput by replacing serial Web
  admission with bounded account-safe parallelism and genuinely batched
  database work, while preserving exact at-least-once processing.

## Success criteria

- A modeled 10x historical connection storm (26,750 events over five minutes)
  drains materially faster than the current one-event-at-a-time Web path.
- Exact resource events are never dropped or coalesced; only accepted or proven
  duplicate entries are acknowledged to Cloudflare Queues.
- Work for one provider account retains the ordering and authority guarantees
  required by the existing device-ingress owner, while independent accounts can
  make bounded progress concurrently.
- Database work uses short, bounded, database-only batch transactions and does
  not move provider parsing, encryption, compression, or network effects into a
  transaction.
- Value-free metrics expose batch size, account-lane count, outcomes, retry
  causes, and duration without payloads or direct identifiers.
- Focused PostgreSQL tests, typechecks, ReviewGPT gates, and exact-head CI pass.

## Scope

- In scope: Cloudflare Queue consumer batching, signed Web admission, shared
  device-ingress batch ownership, database adapters, value-free observability,
  focused load/concurrency proof, and operations documentation.
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
   invariants while adding bounded cross-account parallelism and batch database
   primitives only where they remove demonstrated repeated work.
3. Add value-free batch observability and update the hosted control-plane docs.
4. Run focused unit/integration tests, real-PostgreSQL concurrency proof, a 10x
   modeled load proof, and touched-package typechecks.
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
- Batch only trace/idempotency admission in groups of eight. Each chunk uses one
  bounded transaction for set creation and classification; consent, current
  provider/source authority, encrypted dirty payloads, trace completion, wakes,
  and post-commit signaling remain independently retryable per event.
- Use 100 as the callback count ceiling, but partition dynamically when the
  exact UTF-8 body would exceed 2 MiB. This preserves the common one-callback
  path without making maximum-size valid events fail Web parsing.
- Preserve same-account ordering. The observed peak was concentrated (about
  65% in one account), so the conservative 10x lower-bound model is roughly 58
  minutes at 200 ms/event or 2.4 hours at 500 ms/event before measured trace-
  claim savings; evenly loaded four-lane bounds are about 22 and 56 minutes.
- Accepted the preliminary ReviewGPT coverage findings. The focused suites now
  prove value-free Web and Worker log shapes with private-marker exclusions,
  and the opt-in PostgreSQL suite composes the scheduler, shared ingress, and
  hosted store at the 100-entry maximum instead of proving those owners only in
  isolation.

## Verification

- Focused Web batch tests: 7 passed, covering eight-entry same-account chunks,
  four active account lanes, input-order results, deadline retention, sibling
  failure isolation, and cross-account rollback isolation.
- Signed Web route tests: 4 passed at the 100-entry contract and four-lane bound.
- Shared device ingress: 81 tests passed, including one-account batch admission
  and rejection before claim when a caller mixes accounts.
- Hosted Prisma trace store: 7 focused tests passed, including one transaction
  and two set queries for eight new claims plus duplicate/processed/active/stale
  classification.
- Real PostgreSQL batch proof: 2 passed against a temporary local migrated
  database. The 100-entry 65%-hot-account case reduced the changed slice from
  200 to 116 transactions and from 200 to 131 statements, bounded active
  database operations at four, and measured 109 ms versus 341 ms for the
  scalar control. Its three-account 10x model is 30,096 transactions and 33,442
  statements instead of 53,500 scalar operations.
- Cloudflare Worker: 11 focused tests passed, including one ordinary 100-entry
  callback, exact 2 MiB body partitioning, independent dispositions, and
  explicit success/failure telemetry privacy assertions.
- Hosted transport package: 7 focused tests passed.
- Web, device-syncd, Cloudflare Worker, and hosted-control typechecks passed.
- Preliminary ReviewGPT returned two coverage findings; both are resolved in
  the composed PostgreSQL load proof and direct telemetry privacy assertions.
  The final ReviewGPT gate and corrected exact-head CI remain pending.
