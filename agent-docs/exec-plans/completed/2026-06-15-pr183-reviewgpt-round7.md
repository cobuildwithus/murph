# PR 183 ReviewGPT Round 7 Fixes

## Goal

Fix the accepted ReviewGPT round 7 finding: same-boundary delivery ordering must be a general hosted outbox selection and wake invariant, not only a preferred current-turn rule.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`

## Verification

- Focused hosted runtime callback tests.
- `pnpm typecheck`
- `pnpm test:diff` for the changed files.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
