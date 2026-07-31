# Recover PR 1110 rich-link partial deliveries

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make a post-primary rich-link transport failure recoverable so the user
  eventually receives the URL without replaying the already accepted lead-in.

## Success criteria

- The exact rich-link partial failure remains retryable in the assistant
  outbox and reuses the original delivery idempotency key.
- Web stores the primary provider identity as a recoverable checkpoint but does
  not consume answered mailbox rows until the URL-bearing rich-link or text
  fallback is accepted.
- A later deterministic provider replay can pass the recorded fence safely and
  its completed outcome supersedes only the matching primary checkpoint while
  retaining both provider identities.
- Focused retry, restart, definitive-fallback, receipt, and no-late-replay
  proofs pass, followed by exact-head CI and final ReviewGPT correction review.

## Scope

- In scope: assistant outbox classification, hosted runtime callback payload,
  Web delivery outcome/fence transitions, focused regression tests, delivery
  documentation, PR description, and merge-readiness gates.
- Out of scope: generic ambiguous-delivery semantics, voice memo partials, new
  retry infrastructure, or broader Linq lifecycle refactors.

## Risks and mitigations

1. Risk: retrying the logical delivery could duplicate its primary text.
   Mitigation: preserve the original deterministic primary and `:link` keys;
   prove the provider accepts the primary identity once across recovery.
2. Risk: allowing any accepted outcome to supersede a provider-correlated
   failure could reopen terminal sends.
   Mitigation: permit supersession only for the exact rich-link partial failure
   when the recovered response's primary identity matches the checkpoint.
3. Risk: mailbox rows could be consumed before the URL is visible.
   Mitigation: carry and stamp answered mailbox identities only on an accepted
   final outcome.

## Tasks

1. [x] Add focused failing tests for retryable outbox state, unconsumed partial
   mailbox rows, exact checkpoint supersession, and accepted two-part completion.
2. [x] Implement the smallest outbox, callback, and delivery-store transition
   changes; update the durable delivery contract.
3. [x] Run focused package, Web, hosted-local, typecheck, lint, and diff proof.
4. [x] Prepare the exact correction candidate. Push, correction ReviewGPT, CI,
   current-main reconciliation, and PR-head preflight remain post-plan gates.

## Decisions

- Accept final ReviewGPT round 6's finding: a URL-free lead-in is not a complete
  reply, even when its provider identity is known.
- Preserve the exact partial as synchronous telemetry and a retry checkpoint;
  do not classify it as a terminal ambiguous delivery.
- Reuse the current outbox retry schedule and the existing deterministic replay
  allowance after Web reports that the original provider fence already exists.
- Preserve the one-part provider identity as telemetry, but disable generic
  confirmation promotion so it cannot be mistaken for the completed reply.
- Consume answered mailbox rows only when the accepted two-part outcome
  actually advances the matching checkpoint.

## Verification

- Focused assistant-engine outbox tests, assistant-runtime callback tests, Web
  delivery store/route tests, adapter tests, and hosted-local Linq journey.
- Relevant package typechecks, targeted lint, `git diff --check`, exact-head
  GitHub Actions, final ReviewGPT correction round, and PR-head preflight.

## Evidence

- Proved the former terminal path with a failing outbox test, then passed all 79
  outbox runtime tests with a second durable dispatch using the same key.
- Passed all 209 hosted runtime callback tests, including synchronous partial
  checkpoint recording without answered mailbox identities.
- Passed 253 focused Web Linq HTTP, transport, route, and store tests plus 25
  PostgreSQL lifecycle cases on the isolated worktree database.
- Passed all 233 operator-config tests and typechecks for assistant engine,
  assistant runtime, operator config, Web, and the Cloudflare runner.
- Passed targeted Web ESLint and `git diff --check`.
- Built the complete runner bundle inside every size budget and passed the
  hosted-local Linq journey: ten scenarios passed, including pre-accept link
  failure, unconsumed checkpoint, later recovery, one model invocation, one
  accepted primary, one accepted link, and no late replay.
Completed: 2026-07-30
