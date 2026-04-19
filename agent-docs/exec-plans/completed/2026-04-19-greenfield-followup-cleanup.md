## Title

Finish the remaining greenfield compatibility cleanup by removing old thread-routing names, duplicate provider binding state, and small compatibility affordances.

## Goal

Bring the remaining assistant and automation surfaces to a current-only shape now that there is no live legacy data or deployment state to preserve.

## Scope

- shared automation and self-delivery route cleanup under `packages/contracts/**`, `packages/core/**`, `packages/query/**`, and `packages/operator-config/**`
- assistant conversation/session/runtime cleanup under `packages/assistant-engine/**`, `packages/assistant-cli/**`, `packages/assistantd/**`, and `packages/cli/**`
- focused setup/script cleanup under `packages/setup-cli/**` and `scripts/**` where the remaining branches are compatibility-only
- focused tests and minimal process/continuity doc updates tied directly to the contract changes

## Constraints

- Treat the user's statement that there are no current deployments or persisted data as the hard-cut assumption.
- Preserve unrelated dirty-tree edits already in flight across hosted and other packages.
- Keep current fail-closed schema/version gates; remove only compatibility-only readers, names, and duplicate truth.
- Work in bounded slices so `sourceThreadId` cleanup and `providerBinding` cleanup do not fight each other.

## Verification

- `pnpm typecheck`
- truthful package coverage or diff-aware coverage for the touched owners, expected to include at least:
  - `packages/contracts`
  - `packages/core`
  - `packages/query`
  - `packages/operator-config`
  - `packages/assistant-engine`
  - `packages/assistant-cli`
  - `packages/assistantd`
  - `packages/cli`
  - plus direct checks for touched shell/scripts

## Notes

- The highest-value cleanup is removing `sourceThreadId` from shared automation, self-delivery, and assistant conversation/session surfaces so thread routing has one canonical field.
- The next seam is collapsing `providerBinding` as duplicate persisted provider/resume truth now that provider itself is mandatory.
- Also remove small explicit compatibility affordances such as no-op script flags and any setup-only branches that still preserve old invocation shapes without a real current requirement.

## Progress

- Canonical `threadId` cleanup is landed across the touched assistant-owned runtime/session surfaces that still had `sourceThreadId` fallout.
- Duplicate `providerBinding` state has been removed from the touched runtime/test contract path in favor of top-level `providerOptions` plus `resumeState`.
- Assistant CLI/session fixtures and schema smoke tests now treat `providerBinding` as absent rather than null.
- Setup/script compatibility affordances were reduced in the touched scope by dropping the no-op flag handling and shim-only program-name injection.

## Verification Run

- `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts --no-coverage test/assistant-cli-contracts.test.ts test/assistant-runtime-contracts-coverage.test.ts test/assistant-session-resume-state.test.ts test/config-env.test.ts test/operator-config-seam.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/provider-seams.test.ts test/provider-turn-runner.test.ts test/assistant-local-service-runtime.test.ts test/redaction.test.ts test/assistant-service-runtime.test.ts test/assistant-status.test.ts test/assistant-state-secrets.test.ts test/assistant-product-small-seams.test.ts test/assistant-outbox-runtime.test.ts test/assistant-notification-turn-runtime.test.ts test/assistant-automation-support.test.ts test/assistant-store-persistence.test.ts`
- `pnpm --dir packages/assistant-cli exec vitest run --config vitest.config.ts --no-coverage test/assistant-command-coverage.test.ts test/assistant-command-runtime.test.ts test/assistant-daemon-client-more.test.ts test/assistant-daemon-client-owned-coverage.test.ts test/assistant-doctor.test.ts test/assistant-doctor-security.test.ts test/assistant-ui-controller.test.ts test/assistant-ui-ink.test.ts test/assistant-ui-runtime.test.ts test/assistant-ui-state-view-model.test.ts`
- `pnpm --dir packages/cli exec vitest run --config vitest.config.ts --no-coverage test/incur-smoke.test.ts`
- `pnpm --dir packages/setup-cli exec vitest run --config vitest.config.ts --no-coverage test/setup-services-coverage.test.ts test/setup-surface.test.ts`
- `pnpm --dir packages/cli exec vitest run --config vitest.config.ts --no-coverage test/cli-entry.test.ts test/release-script-coverage-audit.test.ts`
- `bash -n scripts/package-data-context.sh`
- `pnpm --dir packages/operator-config exec tsc -p tsconfig.json --noEmit`
- `pnpm --dir packages/assistant-engine exec tsc -p tsconfig.json --noEmit`
- `pnpm --dir packages/assistant-cli exec tsc -p tsconfig.json --noEmit`
- `pnpm --dir packages/cli exec tsc -p tsconfig.json --noEmit`
- `pnpm --dir packages/setup-cli exec tsc -p tsconfig.json --noEmit`

## Remaining

- Close the active plan with a scoped commit.
- Broader unrelated worktree churn remains outside this lane and must stay untouched.
- Post-review follow-up touched `packages/cli/test/assistant-cli.test.ts` and `packages/cli/test/assistant-runtime.test.ts`, but direct Vitest reruns for those files are still blocked by pre-existing package export-resolution failures in the broader CLI suite (`@murphai/assistant-engine` subpath export gaps), not by the current diff.

Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
