# Retained final delivery context

## Goal

Ensure a final response retained from before a live steer is delivered with
the target, reply-to, source, idempotency, and hosted recipient context that
owned that response.

Success criteria:

- Carry the selected final response's accepted-input ordinal across the Codex
  runtime and provider adapter.
- Resolve the ordinal through the existing reply-delivery context collection
  before persistence and dispatch.
- Fail closed instead of falling back to a different target when an explicit
  final-response ordinal is invalid.
- Prove both the provider seam and the local-service live-steer boundary.

## Constraints

- Extend PR #508 without introducing a second delivery-context map or queue.
- Preserve native commentary isolation, explicit progress, system compaction
  notices, preceding response segments, reactions, no-reply, and media replies.
- Keep other providers backward compatible when no final-response ordinal is
  supplied.
- Keep fixtures and artifacts free of private identifiers and incident text.

## Evidence and root cause

- The Codex runtime already computes `finalDeliveryContextOrdinal` when it
  selects a retained trailing-steer candidate.
- That ordinal was not returned from the runtime or provider adapter.
- Local-service drains live-steered inputs before final dispatch, so
  `currentInput` then represents the newer delivery context.
- A retained pre-steer response could therefore be sent using the newer
  target, reply-to, idempotency key, or hosted recipient identity.
- Security re-audit exposed a second ordinal mismatch: two separately
  acknowledged provider steers were merged into one local admission. Codex
  emitted two user-message ordinals, but local-service appended only one
  delivery context and retained the later admission's target fields.

## Approach

1. Expose the selected final response ordinal through the existing provider
   result.
2. Resolve it with `resolveAssistantReplyDeliveryContextForSegment` and apply
   the context to final response persistence, dispatch, and delivery fields.
3. Throw on an explicit invalid ordinal so final delivery fails closed.
4. Dequeue one provider-acknowledged admission per live-steer drain iteration,
   preserving one delivery context for every provider user-message ordinal.
5. Add focused Codex runtime, provider-adapter, and live-steer local-service
   regression assertions.
6. Run owner coverage, typecheck, required audits, rebase current main, then
   continue the Mountain ReviewGPT loop.

## State

Both ordinal/context mismatches are fixed and verified. Assistant-engine
coverage passed (2,013 tests), workspace typecheck passed, and the isolated
assistant-runtime package passed (1,495 tests; 2 skipped). The diff-aware run
encountered five load-sensitive hosted-runtime failures outside the changed
files; four passed together on immediate focused rerun, the remaining case
passed alone, and the full isolated package then passed. Final security/privacy
and coverage re-audits found no remaining actionable findings. Ready for the
scoped commit, latest-main rebase, and next Mountain ReviewGPT round.

## Working set

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant/active-turn-input-controller.ts`
- `packages/assistant-engine/src/assistant/providers/types.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-engine/test/codex-runtime-helpers.test.ts`
- `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
- PR #508

Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
