# PR 1481 latest-main reconciliation

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Reconcile PR 1481 with the latest `origin/main` while preserving the exact
  reviewed private current-sender Assistant Ask behavior and the newer mainline
  completion/failure handling.

## Success criteria

- The branch contains current `origin/main` with semantic conflict resolutions.
- Private `aask_done_*` completions retain fresh-conversation priority and
  pre-checkpoint causal-outbox admission without widening generic notification
  handling.
- Newer mainline image-completion and runtime-failure ownership remains intact.
- Focused directly affected tests and typechecks pass.
- The base-only reconciliation does not change the reviewed feature patch;
  required exact-head CI returns green and the PR is merge-ready.

## Tasks

1. Inspect the conflicting base changes and merge current `origin/main`.
2. Resolve each conflict as the smallest semantic union and inspect the complete
   reconciliation diff.
3. Run focused Assistant Runtime and Cloudflare bundle-budget proof.
4. Close this plan in a scoped reconciliation commit, push, and watch exact-head
   CI and mergeability to completion.

## Verification

- `pnpm --filter @murphai/assistant-runtime typecheck` — passed.
- `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-image-generation.test.ts test/hosted-runtime-turn-input.test.ts` — 4 files and 592 tests passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-bundle-entrypoint-bundle.test.ts` — 42 tests passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-bundle-cli-bundle.test.ts` — 8 tests passed.
- `pnpm --filter @murphai/cloudflare-runner typecheck` — passed.
- `pnpm --filter @murphai/cloudflare-runner runner:bundle:assemble-only` — passed against the rebuilt final-base package closure: vault CLI 9,012,752B total / 793B entry; runner entrypoint 10,032,390B total / 1,688,020B entry / 8,052,176B static closure; all parity probes passed.
- `git diff --check` — passed.
- Exact-head required CI, final ReviewGPT refresh for the isolated PR-specific
  budget ratchet, and mergeability proof follow the final push.
Completed: 2026-08-10
