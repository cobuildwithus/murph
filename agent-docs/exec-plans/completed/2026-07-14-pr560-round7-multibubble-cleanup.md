# PR 560 ReviewGPT Round 7 Multi-Bubble Cleanup

## Outcome

Prevent any queued reply bubble from surviving when pre-commit causal-context
validation rejects the turn or assistant turn-artifact finalization fails.

## Constraints

- Keep the existing outbox intent as the sole delivery owner; add no queue,
  repair worker, or second lifecycle state.
- Preserve ordered, once-only multi-bubble delivery for successful turns.
- Preserve the existing final-bubble outcome as the caller-visible delivery
  result while carrying every queued current-turn intent id for cleanup.
- Keep PR #585 held until the corrected exact PR #560 head is pushed and
  reviewed.

## Steps

1. Extend the existing delivery outcome with a bounded list of queued intent
   ids and compose it across reply bubbles and preceding reply segments.
2. Make the existing commit-failure cleanup abandon every unique queued intent
   represented by those outcomes.
3. Add focused proof for two-bubble invalidation, multi-bubble preceding
   replies, artifact-finalization failure, and ordered successful delivery.
4. Run scoped verification and required completion audits under the host guard,
   commit and push the exact branch head, then run one exact-head ReviewGPT
   round 8 concurrently with CI.

## Status

- Ready for CI-backed verification: the owner-bound implementation and focused
  proof are written, and security/privacy plus coverage-write audits both
  returned zero findings. The next step is the exact-head push followed by CI
  and ReviewGPT round 8.

## Verification

- `git diff --check` passed.
- Final scope, privacy, and delivery-outcome type-boundary checks passed.
- Security/privacy audit: zero medium-or-higher findings.
- Coverage-write audit: zero coverage gaps; the four requested scenarios map
  directly to the production aggregation and cleanup paths.
- Local executable checks were unavailable because the controller's only heavy
  slot remained owned by a long-running acceptance process under sustained
  unsafe host load. The controller authorized exact-head CI as the next-best
  executable proof, concurrent with ReviewGPT round 8.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
