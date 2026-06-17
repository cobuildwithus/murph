# Steered Segment Delivery Order

## Goal

Fix hosted queue-only delivery ordering for Codex steered turns so preserved
pre-steer final answers dispatch before the later final answer.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- focused assistant-runtime tests

## Constraints

- Preserve existing active-turn steering behavior.
- Keep delivery idempotency deterministic.
- Do not expose message contents from production logs or screenshots in fixtures.
- Do not change the public assistant result schema for queue-only hosted replies.

## Plan

1. Promote due same-turn outbox intents whenever a preferred current-turn final
   intent is selected for foreground hosted dispatch.
2. Keep unrelated due intents on the background retry path and preserve the
   existing background cap.
3. Reset unprocessed prepared successors on abort and block later same-turn
   foreground dispatch after a retryable predecessor failure.
4. Add focused regression coverage for hosted queue-only steered replies.
5. Run scoped assistant-runtime tests, typecheck, and diff verification.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
