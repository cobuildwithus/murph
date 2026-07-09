# PR 357 Habitat Review Fixes

## Goal

Close the worthwhile Habitat PR review findings without changing the vertical-slice architecture.

## Constraints

- Keep Habitat coverage as the single derived source of truth.
- Do not add stored snapshot or coverage state.
- Keep fixes scoped to the assistant snapshot, CLI adapter, and contract validation.
- Preserve the PR branch worktree and unrelated active ledger rows.

## Plan

1. Surface stale Habitat indicators in the assistant context snapshot line and use the injected refresh clock.
2. Tighten `vault-cli habitat` parsing and counts without changing command schemas.
3. Reject orphan or foreign `indicatorRecordedAt` keys in Habitat frontmatter.
4. Add focused tests for snapshot rendering, CLI behavior, and contract validation.
5. Run scoped verification, then finish with a scoped commit on the PR branch.

## Verification

- `pnpm --dir packages/contracts test:vitest -- habitat.test.ts`
- `pnpm --dir packages/assistant-engine test -- assistant-context-snapshot.test.ts`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/habitat-command.test.ts`
- `pnpm --dir packages/cli typecheck`
- `pnpm typecheck`
- `pnpm test:smoke`
- `pnpm test:diff packages/assistant-engine/src/assistant/context-snapshot.ts packages/assistant-engine/test/assistant-context-snapshot.test.ts packages/cli/src/commands/habitat.ts packages/cli/test/habitat-command.test.ts packages/contracts/src/zod.ts packages/contracts/src/habitat-catalog.ts packages/contracts/test/habitat.test.ts`
- `git diff --check`

## State

Implemented and verified. The first `test:diff` attempt failed in `packages/hosted-local-harness` because this fresh worktree did not have `packages/assistant-runtime/dist`; after building `packages/assistant-runtime`, the hosted-local-harness package test and the full `test:diff` rerun passed.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
