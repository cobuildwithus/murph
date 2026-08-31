# Close concurrent Linq receipt/acceptance gap

Status: blocked on ReviewGPT implementation availability
Created: 2026-08-30
Updated: 2026-08-31

## Goal

- Ensure a terminal Linq provider receipt and the matching accepted delivery
  cannot commit concurrently while each misses the other, leaving durable
  delivery state nonterminal after the member's message was delivered.

## Success criteria

- A focused real-PostgreSQL regression reproduces the concurrent
  acceptance/receipt write-skew on the pre-fix code.
- The smallest existing-owner correction makes either commit order converge on
  one terminal delivery without duplicating provider sends or receipt effects.
- Focused unit/PostgreSQL proof, Web typecheck, required audits, ReviewGPT, and
  exact-head CI pass.
- A privacy-safe PR is ready for human merge; production is not mutated by this
  sweep.

## Scope

- In scope: Web-owned Linq delivery acceptance, provider-event receipt
  correlation, transaction ordering, focused regression proof, and the owning
  reliability contract if the correction establishes a new durable rule.
- Out of scope: provider sends, message copy, webhook verification, schemas,
  backfills, device sync, delivery retries, queues, and production repair.

## Constraints

- Technical constraints: retain the existing `HostedLinqDelivery` and
  `HostedLinqProviderEvent` owners; use a bounded database-only serialization
  boundary; add no state owner, dependency, schema, provider call, or unbounded
  transaction work.
- Product/process constraints: keep production evidence private; do not replay
  or resend any production message; use ReviewGPT for implementation because
  messaging and concurrency semantics exclude the local tiny-fix route.

## Risks and mitigations

1. Risk: serializing the wrong identity can miss legacy message-key candidates
   or add broad contention.
   Mitigation: reuse the canonical normalized message-key candidates and prove
   both receipt-first and acceptance-first order with distinct synthetic rows.
2. Risk: terminal receipt side effects can run twice after convergence.
   Mitigation: retain the existing monotonic receipt-order predicate and assert
   one terminal transition and idempotent replay.
3. Risk: a lock or retry extends the foreground reply critical path.
   Mitigation: keep the transaction database-only and one-key scoped, record
   exact statement/call-count impact, and reject broader retry machinery.

## Tasks

1. Add a focused real-PostgreSQL diagnostic that coordinates the two
   transactions and proves the current write-skew.
2. Give ReviewGPT the privacy-safe root-cause packet and obtain the smallest
   owning-boundary correction.
3. Inspect and apply only a root-cause-aligned patch, then run focused proof and
   affected typecheck.
4. Complete repository audits, commit/push, open the PR, and run specialist and
   final ReviewGPT gates concurrently with CI.

## Decisions

- The stale row is a projection defect, not a failed user delivery: production
  contains the matching terminal provider event and no failed receipt.
- The root-cause hypothesis is concurrent transaction visibility, not missing
  message identity: the persisted delivery and provider event have equal
  canonical lookup keys, the receipt arrived 1.161 seconds after the recorded
  accepted timestamp, and each current transaction contains only a one-sided
  catch-up read with no shared serialization owner.
- Active PR #2634 is non-overlapping: it changes only planner decomposition in
  `webhook-provider-linq.ts` and explicitly preserves persistence and retry
  behavior; the selected owner boundary is the provider-event/delivery store.
- A handoff-time refresh found new PR #2645, but its diff is limited to
  identity-less Linq transport-response validation in `packages/operator-config`;
  it does not touch delivery or provider-event persistence. No post-cut commit
  on `origin/main` changed either selected owner file. The new adjacent PR is
  therefore not an exact owner or non-coexistence conflict.
- The local real-PostgreSQL diagnostic deterministically reproduces the
  production state: after both overlapping transactions commit, the provider
  event is durable while the delivery remains `accepted` with null terminal
  receipt fields.
- ReviewGPT implementation attempt 1 staged the exact current snapshot and
  privacy-safe packet, waited the repository-default 250 minutes, and ended
  without a response capture or patch. A fresh retry on a different managed
  browser lane also returned no response during its bounded follow-up window
  and was stopped. No production implementation was applied or authored
  locally because messaging/concurrency semantics require ReviewGPT ownership.

## Verification

- Commands to run: focused Linq observability-store PostgreSQL concurrency
  regression; focused Linq store unit suite; `pnpm --dir apps/web typecheck`;
  repository diff/privacy checks; required ReviewGPT and GitHub checks.
- Expected outcomes: both concurrent commit orders end `delivered`, provider
  event and delivery progress remain monotonic, replay is idempotent, and no
  send, schema, or cross-runtime behavior changes.
