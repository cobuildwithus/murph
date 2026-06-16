# PR 183 ReviewGPT Round 2

## Goal

Resolve the accepted ReviewGPT round-2 finding for PR 183's hosted delivery
ordering fix.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`

## Constraints

- Keep collection and drain delivery-boundary definitions aligned.
- Do not block or reset a different actor's foreground delivery after an
  unrelated retryable predecessor failure.

## Plan

1. Include actor id in the drain-side hosted delivery boundary key.
2. Add a focused regression for same-turn/same-target different-actor effects.
3. Run scoped verification and rerun ReviewGPT.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
