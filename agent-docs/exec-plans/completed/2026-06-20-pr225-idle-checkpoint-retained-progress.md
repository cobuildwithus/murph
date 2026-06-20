# PR 225 Idle Checkpoint Retained Progress

## Goal

Fix the hosted-local idle-checkpoint E2E helper so a mixed log stream with stale
deferred progress and retained local mailbox progress can still prove foreground
progress through the expected conversation sequence.

## Constraints

- Keep the change in the E2E helper and helper tests only.
- Do not change runtime write-fence, snapshot, or retry semantics.
- Preserve the stricter check that bare deferred progress needs assistant
  completion at or after that deferred import.

## Plan

1. Let retained local progress be considered after an incomplete
   deferred-progress candidate.
2. Add a regression that mirrors the CI failure shape.
3. Run the focused helper test/typecheck and push the PR branch.

## Verification

- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts -t "hosted local idle checkpoint deferred progress log helpers" --no-coverage` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `git diff --check` passed.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
