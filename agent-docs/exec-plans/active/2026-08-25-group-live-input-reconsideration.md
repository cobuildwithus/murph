# Reconsider group input accepted during provider generation

## Outcome

Group auto-replies produce one final result covering every still-relevant request
accepted into the held turn, including input that arrives while the first provider
request is still generating.

## Scope

- Reuse the existing one-shot ordinal-1 group reconsideration and native-resume
  cleanup path.
- Track whether request 0 accepted live-steered group input and require the
  existing final reconsideration when it did.
- Add focused deterministic coverage for the in-generation timing boundary and
  preserve the existing quiet, draft-window, direct-chat, floor, usage, and
  failure behavior.
- Add or adapt provider-path proof so the test exercises live input during
  request 0 rather than only input arriving after the draft.

## Non-goals

- No new queue, scheduler, state machine, provider abstraction, database state,
  or timing window.
- No change to direct-chat reply batching.
- No transcript-, member-, or production-log-derived fixture data.

## Verification

- Focused assistant-engine live-input tests for request-0 live steering and
  ordinal-1 selection/cleanup.
- Assistant-engine typecheck and diff/privacy checks.
- Authenticated provider-path proof when the local environment supports it.
- Preliminary completion-specialist review, applicable final ReviewGPT gate,
  and green exact-head required CI before merge.
- Protected Cloudflare production deploy with exact-source and live-runner
  convergence proof.

## Status

- [x] Production evidence and code-path root cause proved.
- [x] Minimal implementation and focused regression coverage complete.
- [x] Local verification and candidate review complete.
- [ ] ReviewGPT and exact-head CI green.
- [ ] PR merged, production deployed, and live convergence proved.
