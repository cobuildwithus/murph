# Repair failing CLI package tests

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Restore the currently failing CLI package test lane by fixing stale export/help assertions and any real regressions in provider/food/recipe edit flows without disturbing unrelated app or hosted-runtime work.

## Success criteria

- `packages/cli/test/assistant-core-facades.test.ts` passes.
- The currently failing cases in `packages/cli/test/cli-expansion-provider-event-samples.test.ts` pass.
- Required repo verification for the touched CLI/assistant-owner surface passes.

## Scope

- In scope:
- `packages/assistant-cli/package.json` if the export surface changed and tests are stale.
- `packages/assistant-engine/**` and `packages/cli/**` code/tests needed to repair the failing CLI cases.
- Focused test-command selection and any matching plan/ledger updates.
- Out of scope:
- Unrelated app, hosted-runtime, or Cloudflare changes already in flight elsewhere in the worktree.
- Broad package-boundary redesign beyond what the failing tests require.

## Constraints

- Technical constraints:
- Preserve unrelated dirty worktree edits.
- Keep workspace package imports on declared public entrypoints.
- Product/process constraints:
- Close the active plan via `scripts/finish-task` if this task lands in this turn.
- Run tests and typecheck after the repair unless blocked by unrelated failures.

## Risks and mitigations

1. Risk: Some current failures may reflect intentional behavior changes rather than regressions.
   Mitigation: Read the implementation and current command/help surfaces before changing code; prefer updating stale assertions when behavior is deliberate.
2. Risk: The CLI package test entrypoint runs a broad suite and may expose unrelated red tests.
   Mitigation: Use focused workspace-config runs for diagnosis, then re-run the package lane and document any unrelated remaining failures.

## Tasks

1. Inspect the failing tests and current implementation for assistant-cli exports, help text, and provider/food/recipe edit flows.
2. Patch the minimal set of manifests, tests, or runtime code needed to make the failures green.
3. Run focused CLI tests, then repo-required verification.
4. Run the required final review, address findings, and finish the task with a scoped commit.

## Decisions

- The assistant-cli export assertion failures were stale tests; the current package intentionally exports only `./commands/assistant` and `./run-terminal-logging`.
- The workout-format validation and meal-manifest help failures were stale assertions against current CLI behavior.
- The recipe edit failures were a real regression caused by the edit path feeding an extra `links` field from the read model back into the strict recipe payload parser.

## Verification

- Commands to run:
- Focused `vitest` runs for the failing CLI files under `packages/cli/vitest.workspace.ts`
- `pnpm typecheck`
- `pnpm --dir packages/cli test -- assistant-core-facades.test.ts` or the narrowest package-level equivalent that exercises the repaired lane
- Expected outcomes:
- The previously failing CLI assertions and edit-flow scenarios pass.
- Root typecheck passes after the repair.

## Progress update

- Focused verification passed:
  - `pnpm --dir . exec vitest run --config packages/cli/vitest.workspace.ts --project cli-assistant packages/cli/test/assistant-core-facades.test.ts --no-coverage`
  - `pnpm --dir . exec vitest run --config packages/cli/vitest.workspace.ts --project cli-expansions packages/cli/test/cli-expansion-provider-event-samples.test.ts --no-coverage`
- Broader verification passed:
  - `pnpm --dir packages/cli test -- assistant-core-facades.test.ts`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `pnpm test:packages`
Completed: 2026-04-08
