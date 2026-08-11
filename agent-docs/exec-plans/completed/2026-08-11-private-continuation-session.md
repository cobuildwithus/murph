# Preserve private Assistant Ask continuity

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Keep an exact private Assistant Ask completion in the member's existing
  direct assistant session so the next direct turn can continue from it.

## Success criteria

- Exact private completions retain the existing direct-session continuity
  identity while generic detached notifications remain output-only.
- The next direct input reuses the same assistant session and can observe the
  trusted private completion transcript.
- Existing member, route, expiry, exact-text, and no-group-delivery gates stay
  fail closed at every provider attempt.
- Focused regression tests and owning package typechecks pass on the PR head.
- Required ReviewGPT and GitHub checks pass.

## Scope

- In scope: the private Assistant Ask completion notification, its direct
  session resolution/persistence, model-facing current-sender tool guidance
  where direct evidence proves it incomplete, focused tests, and durable docs.
- Out of scope: new mailbox kinds, new delivery coordinators, cross-member or
  group transcript import, provider-generated paraphrasing, and deployment.

## Constraints

- Technical constraints: reuse the existing queue-only exact-text consumer and
  direct-session owner; do not weaken Web-owned authority or scheduling gates.
- Product/process constraints: use only synthetic evidence in review/test
  artifacts, preserve unrelated work, and keep the patch minimal.

## Risks and mitigations

1. Risk: an exact completion could enter the wrong member, route, or group.
   Mitigation: preserve all existing Web assertions and provider-entry checks;
   test direct-only rejection paths.
2. Risk: broad notification changes could make detached work mutate ordinary
   conversation state.
   Mitigation: specialize only the authenticated private-completion family and
   retain the output-only default for every other notification.
3. Risk: deployment skew could strand or misread completion payloads.
   Mitigation: prefer an additive compatible contract and document the safe
   Web-before-runner rollout plus live same-channel proof.

## Tasks

1. Reproduce the continuity break from the exact runtime and session code path.
2. Ask ReviewGPT Pro for a privacy-safe, test-backed patch.
3. Inspect and apply the smallest valid correction plus regressions.
4. Run focused tests, typechecks, docs checks, and required completion reviews.
5. Push a scoped PR and wait for required checks.

## Decisions

- The vault archive is not needed: code-path and redacted production evidence
  already prove the failure, and the review bundle must exclude private data.
- ReviewGPT's first patch preserved the logical session but left an older
  provider-native resume pointer that could still hide the out-of-band reply.
  The replacement patch keeps the logical session and ordinary target while
  clearing both resume aliases in the existing exact-text session save.
- The continuity exception requires the complete authenticated private
  completion envelope. A reviewed-expiry marker by itself remains insufficient.
- Generic detached notifications, first-contact welcomes, route authority,
  delivery scheduling, and exact-text policy retain their existing owners.

## Verification

- Commands: focused assistant-engine/runtime/Web tests chosen from the final
  diff; owning package typechecks; docs drift; PR-head ReviewGPT and CI.
- Expected outcomes: one existing direct session remains selected before and
  after private completion, exact text is preserved, and unauthorized or stale
  deliveries never enter provider transport.
- Passed locally: the notification audience integration suite (9 tests), the
  notification-turn runtime suite (54 tests), three native-resume/transcript
  planner regressions, and the assistant-engine package typecheck.
- Passed locally after adding the public entry: the changelog fragment suite
  (7 tests), Web typecheck, full-PR docs drift, and diff whitespace check.
Completed: 2026-08-11
