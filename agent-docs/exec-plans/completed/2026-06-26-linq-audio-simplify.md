# Linq Audio Download Simplify

## Goal

Land the Linq audio patch as a small PR: retry transient hosted Linq attachment download failures briefly, keep provider replies unblocked when audio remains unavailable, and stop prompt rendering from exposing internal missing raw/stored paths.

## Constraints

- Keep the fix narrow and composable: retry at acquisition, sanitize at prompt construction, no new readiness state machine.
- Preserve foreground reply behavior when attachment bytes cannot be fetched.
- Do not expose raw storage internals or local/private identifiers in prompts, logs, docs, or PR text.
- Use the PR-lane ReviewGPT loop after the branch is pushed.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/linq.ts`
- `packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts`

## Verification Plan

- Focused assistant-runtime Linq event tests.
- Focused assistant-engine prompt-builder tests.
- `pnpm typecheck`.
- Diff/final review before commit.
- External ReviewGPT PR loop to zero accepted findings after PR opens.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
