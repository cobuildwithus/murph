# Onboarding Wearable Check

## Goal

Prevent conversation onboarding from asking users whether they use a wearable or app when connected device context is already visible.

Success criteria:

- Onboarding guidance requires checking visible vault/device context before asking about wearable connections.
- Connected upstream wearable sources are treated as already available data sources.
- Prompt tests cover the new sequencing rule.

## Constraints

- Keep the change local to assistant prompt guidance and focused tests unless inspection shows the runtime context is missing.
- Preserve existing device-sync account/source architecture and unrelated dirty worktree edits.
- Do not add persisted state or onboarding-specific branching.

## Plan

1. Inspect onboarding prompt and available device-account context.
2. Tighten the data-source step so wearable connection questions happen only after visible context and device account checks show no connected source.
3. Update focused prompt behavior tests.
4. Run focused tests, typecheck, and diff review.
5. Commit scoped changes if verification passes.

## Verification

- `pnpm --filter @murphai/assistant-engine exec vitest run test/model-behavior.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --filter @murphai/assistant-engine typecheck` passed.
- `pnpm --filter @murphai/assistant-engine test` passed.
- `pnpm typecheck` was attempted but stopped after waiting on a pre-existing `apps/web` verification workspace lock.

## Handoff Notes

- Conversation onboarding now checks visible context and, when unclear, `vault-cli device account list --format json` before asking whether the user uses a wearable/app.
- Connected device sources should be named by the user-facing provider/source rather than bridge plumbing.

Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
