# PR 183 ReviewGPT Round 4 Fixes

## Goal

Fix the accepted ReviewGPT round 4 findings for PR 183:

- Do not foreground-dispatch a later same-boundary current-turn reply while an earlier same-boundary pending/retryable/sending predecessor is not dispatchable yet.
- Include Linq delivery source identity in hosted assistant delivery boundary comparisons.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- `packages/hosted-execution/src/side-effects.ts`
- `packages/hosted-execution/test/side-effects.test.ts`
- `packages/hosted-execution/test/hosted-execution-observability-side-effects.test.ts`

## Verification

- Focused assistant-runtime hosted callback tests.
- Focused hosted-execution side-effect payload tests.
- `pnpm typecheck`
- `pnpm test:diff` for the changed files.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
