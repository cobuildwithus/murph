# Signup welcome home-route materialization

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Persist the direct Linq chat returned by an accepted Murph-owned signup
  welcome as the member's canonical home route, so proactive onboarding can
  continue before the member replies.

## Success criteria

- An accepted canonical participant signup welcome atomically records its
  delivery outcome and materializes the returned direct chat under the existing
  Web routing owner and lock hierarchy.
- The callback proves authenticated member, original verified participant,
  assigned sender line, dispatch provenance, direct participant target, and
  exact signup-welcome identity before routing changes.
- Duplicate callbacks are idempotent; a delayed callback cannot replace a
  different established home route; provider/dashboard telemetry remains
  non-authoritative.
- A transient callback failure after provider acceptance is surfaced as an
  ambiguous/may-have-succeeded delivery so replay uses existing provider
  idempotency without a duplicate visible welcome.
- Focused Web/runtime tests and a zero-inbound hosted-local scenario prove that
  the accepted welcome persists the canonical chat before any member reply, so
  the existing proactive route resolver no longer reaches the missing-route
  authority failure.

## Scope

- In scope: the hosted Linq delivery callback, home-route policy/store reuse,
  assistant-runtime delivery-outcome contract and retry classification, focused
  tests, hosted-local onboarding-follow-up proof, and directly matching durable
  runtime documentation if behavior claims require it.
- Out of scope: generic binding from manual dashboard/provider events, new
  queues or reconciliation services, provider-side chat lookup, schema changes,
  automation-route ownership changes, and unrelated mailbox/webhook work.

## Constraints

- Work only in the isolated task worktree on
  `codex/signup-welcome-home-route`; preserve all unrelated checkout and ledger
  work.
- Reuse the existing Web routing owner, encrypted route storage, lookup keys,
  advisory locks, provider-dispatch fence, and provider idempotency.
- Keep raw participant phone evidence transient: do not persist or log it.
- Follow the member-home -> chat-ownership -> delivery transition lock order.
- Do not weaken the existing fail-closed egress authority check or make generic
  provider telemetry a route owner.

## Risks and mitigations

1. Risk: a delayed callback overwrites a newer inbound-established route.
   Mitigation: re-read routing under the home-member lock and treat a different
   established home chat as a successful stale no-op.
2. Risk: a callback binds the wrong participant after an identity change.
   Mitigation: carry the original direct recipient transiently and compare its
   lookup key with the locked, currently verified member identity.
3. Risk: callback failure after provider acceptance causes a duplicate welcome.
   Mitigation: make canonical accepted welcome recording required, classify
   failure as possibly delivered, and rely on the existing canonical provider
   idempotency key and dispatch fence during replay.
4. Risk: Web and hosted runners deploy with temporarily different callback
   contracts.
   Mitigation: keep additive request compatibility where safe, deploy Web before
   runners in a tight window, and verify route materialization after rollout.

## Tasks

1. Add the narrow trusted materialization policy and exact callback validation.
2. Extend the runtime outcome contract with transient participant evidence and
   require canonical accepted signup-welcome outcome recording.
3. Add regression coverage for valid, replayed, stale, and invalid callbacks,
   including the zero-inbound next-day route seam.
4. Run focused and full required verification, coverage audit, parent final
   review, exact-head ReviewGPT, and CI.
5. Close the plan with a scoped commit, push, and open the intent-complete PR.

## Decisions

- Manual/dashboard sends remain observability-only because they lack an
  authenticated Murph member and verified route authority.
- Web remains the sole canonical routing owner; stored automation targets remain
  hints resolved against current Web state.
- Add no persisted state, migration, queue, scheduler, provider reconciler, or
  second routing abstraction.

## Verification

- Focused Web delivery-route and home-routing tests.
- Focused assistant-runtime callback tests and affected runtime/engine tests.
- Hosted-local Linq onboarding-follow-up scenario with route proof before any
  inbound message.
- Truthful owner-level/full verification per
  `agent-docs/operations/verification-and-runtime.md`, `git diff --check`,
  required `coverage-write`, parent final review, PR CI, and exact-head
  ReviewGPT pass.
Completed: 2026-07-16
