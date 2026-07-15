# PR 550 Causal Personalization Correction

## Goal

Preserve the accepted provider turn's owner-assigned causal sequence through the
conversation personalization mutation so delayed or replayed older turns cannot
overwrite newer Settings intent.

## Constraints

- Reuse the existing mailbox causal ordering and preference mutation owner.
- Keep causal authority outside model-visible tool JSON and bind it to the
  signed invocation path.
- Preserve field-local updates, same-turn command order, private-turn gating,
  and the separate configuration approval flow.
- Add no queue, service, lifecycle owner, or wall-clock ordering fallback.
- This task forbids subagents; complete parent-owned reviews locally.

## Verification

- Focused hosted-execution, assistant-engine/runtime, Cloudflare, and web tests.
- Affected package typechecks and final diff/privacy/architecture review.
- Guarded push, concurrent CI, and a fresh exact-head ReviewGPT 0.5.106
  Pro/current round.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
