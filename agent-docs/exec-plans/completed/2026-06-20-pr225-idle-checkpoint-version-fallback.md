# PR 225 Idle Checkpoint Version Fallback

## Goal

Fix the hosted-local idle-checkpoint E2E helper so foreground mailbox progress
logs can prove the expected conversation sequence even when the active runner
attempt logs use the pre-checkpoint workspace version and the visible workspace
has already advanced.

## Constraints

- Keep this in the E2E helper and helper tests only.
- Prefer exact workspace-version matches before falling back to seq-only
  foreground progress evidence.
- Do not change runtime checkpoint, write-fence, or recovery behavior.

## Plan

1. Factor foreground progress evidence matching so exact-version matching is
   tried first.
2. Add a fallback that drops the workspace-version constraint only when exact
   evidence is absent.
3. Add a helper regression and rerun focused local checks.

## Verification

- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts -t "hosted local idle checkpoint deferred progress log helpers" --no-coverage` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `git diff --check` passed.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
