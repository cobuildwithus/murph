# Make private completion continuity authority-safe

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Join an authenticated private Assistant Ask completion into the member's
  ordinary direct conversation only after live delivery authority accepts it,
  with replay-safe transcript and native-resume continuity.

## Success criteria

- Expired, wrong-member, and wrong-route completions leave the ordinary direct
  session and transcript unchanged and never enter provider transport.
- A delivered completion appears exactly once in the ordinary transcript,
  clears both native-resume aliases, and advances the session once.
- A failure between coupled persistence steps plus retry converges to the same
  state without duplicate text or a stale native provider thread.
- The next attended direct turn reuses the same logical session with the
  delivered completion in bounded provider-visible history.
- Focused tests, owning typechecks, final ReviewGPT, and applicable CI pass or
  prove any remaining failure is identical on the base head.

## Scope

- In scope: hosted private-completion outbox dispatch, the existing
  post-provider-acceptance persistence hook, one stable completion-keyed
  runtime-state transition, focused failure/retry and authority tests, and
  matching durable docs.
- Out of scope: new mailbox kinds, provider turns, delivery coordinators,
  database owners, prompt changes, group delivery, deployment, and unrelated
  current-main test failures.

## Constraints

- Technical constraints: retain provider-entry live authority revalidation;
  do not mutate the ordinary session during queue creation; reuse the existing
  outbox idempotency key and runtime write lock; make partial state recoverable
  before foreground resume selection.
- Product/process constraints: preserve exact-text and no-group-delivery
  guarantees, keep all examples synthetic, and do not broaden the patch to the
  three assistant tests already failing identically on the base head.

## Risks and mitigations

1. Risk: delivery succeeds but a crash leaves transcript and session metadata
   out of sync.
   Mitigation: key the transition by the existing completion idempotency key
   and make retry or foreground resolution converge before provider resume.
2. Risk: early continuity selection exposes rejected content or mutates a
   private conversation without live authority.
   Mitigation: keep queue creation detached and perform the join only from the
   post-provider-acceptance hosted dispatch hook.
3. Risk: a broad outbox change affects generic notifications.
   Mitigation: require the complete private-completion proof and keep the
   generic hook path a no-op, with negative regression coverage.

## Tasks

1. Inspect ReviewGPT's replacement patch against the existing outbox, authority,
   session, transcript, and crash-recovery owners.
2. Apply only the smallest architecture-valid correction and focused tests.
3. Run targeted authority, replay, continuation, runtime, and typecheck proof.
4. Push one corrected candidate; resolve final ReviewGPT and CI gates.
5. Merge the accepted PR and retire the task worktree.

## Decisions

- The specialist findings are accepted: queue-time ordinary-session mutation
  and separate non-idempotent transcript/session writes are release blockers.
- The current main head has the same three unrelated assistant-suite failures
  as this PR; they remain outside this task unless a base update resolves them.
- The existing hosted outbox `persistDeliveredIntent` hook is the candidate
  ownership boundary because it runs after provider acceptance and before sent
  finalization.
- Final round 2 found that same-route sibling inference could choose a detached
  session and that top-level directness plus multimodal content did not model
  ordinary hosted text. Both findings are accepted: queue-time resolution now
  binds only an exact existing ordinary session, otherwise leaves continuity
  unbound, while repair uses canonical nested directness and accepted inbound
  input authority rather than payload shape.

## Verification

- Commands to run: focused assistant-engine and assistant-runtime Vitest files,
  owning package typechecks, docs drift, diff check, PR ReviewGPT rounds, and
  GitHub checks on the corrected exact head.
- Expected outcomes: zero hidden mutation on rejection, exactly-once continuity
  on delivery and retry, no stale native resume, no group delivery, and no
  regression to generic detached notifications.
Completed: 2026-08-11
