# PR 183 ReviewGPT Round 1

## Goal

Resolve accepted ReviewGPT round-1 findings for PR 183's hosted steered reply
delivery ordering fix.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`

## Constraints

- Preserve queue-only hosted reply ordering for Telegram and Linq.
- Do not broaden same-turn promotion across unrelated delivery targets.
- Keep public assistant result schema unchanged.

## Plan

1. Replace target-fingerprint grouping with a hosted delivery boundary that
   excludes reply target ids.
2. Store preferred order per delivery boundary, not only per turn.
3. Sort same-boundary foreground siblings chronologically before status.
4. Add focused regressions for realistic target fingerprints, retryable
   predecessor ordering, and multiple preferred boundaries.
5. Run scoped verification and rerun ReviewGPT.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
