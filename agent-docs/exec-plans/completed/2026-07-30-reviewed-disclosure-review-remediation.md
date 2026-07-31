# Reviewed disclosure final-review remediation

## Outcome

Resolve the accepted final ReviewGPT findings on the reviewed group-disclosure
path while preserving the automatic drain, exact-message authority, isolated
group composition, and one proof-bound delivery.

## Scope

- Replace the first-use consent bag-of-tokens matcher with one narrow anchored
  authorization grammar whose bounded subject may contain ordinary negation.
- Reproduce and remove group active-speaker drift from explicit-session
  continuation resolution without enabling generic binding rebinding.
- Make post-return preemption status-aware so a completed continuation is
  terminal and an uncommitted expired continuation remains retryable.
- Preserve current `main` accepted-message targeting and durable documentation.

## Invariants

- An explicit refusal never acknowledges the privacy explanation or launches a
  private read.
- A negative predicate inside an affirmative bounded subject remains valid.
- A later group speaker cannot retarget or strand an earlier sender's reviewed
  completion.
- Once the continuation commits its outbox intent and canonical transcript, the
  completion cannot be retried as unfinished.
- Thread, channel, identity, directness, delivery target, origin, expiry, and
  disclosure authority continue to fail closed.

## Steps

1. Add focused failing reproductions for refusal wording, group speaker drift,
   and post-commit preemption.
2. Implement the smallest owner-preserving corrections.
3. Run the affected Web, assistant-engine, assistant-runtime, parser, docs, and
   typecheck proof.
4. Push the current-main head, update the PR contract and change shape, run
   exact-head CI, and complete ReviewGPT correction round 2.

## Evidence

- Final ReviewGPT round 1 returned three original-patch findings covering the
  consent matcher, group actor drift, and late preemption.
- Focused pre-fix tests reproduced all three failures: an explicit refusal was
  accepted, a later group speaker caused an exact session-routing conflict, and
  a completed continuation was reclassified as preempted.
- The corrected focused Web admission file passes 8/8 tests, the affected
  assistant-engine files pass 174/174 tests, and the affected
  assistant-runtime files pass 307/307 tests. Hosted-execution parser tests pass
  4/4.
- Hosted-execution, assistant-engine, assistant-runtime, and Web typechecks
  pass. Focused Web lint, docs drift, and `git diff --check` pass.

Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
