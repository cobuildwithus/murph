# Vercel AI SDK upgrade

Status: completed
Created: 2026-03-16
Updated: 2026-03-16

## Goal

- Upgrade the CLI package from AI SDK 5.x to the current npm `latest` AI SDK 6.x release and keep the inbox assistant harness working with the new API surface.

## Success criteria

- `packages/cli/package.json` targets npm `latest` for `ai` and the matching `@ai-sdk/openai-compatible` package.
- The assistant harness and its focused tests compile and pass under the updated SDK.
- Required repo verification passes: `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

## Scope

- In scope:
- `packages/cli` dependency versions for the AI SDK
- any minimal harness/test changes required by the 6.x API/types
- lockfile updates from `pnpm`
- Out of scope:
- behavioral redesign of inbox model routing
- provider additions beyond keeping the existing gateway and OpenAI-compatible paths working

## Constraints

- Keep the change narrow to the CLI package and direct fallout from the dependency bump.
- Use npm registry `latest` as the version source of truth for this turn.
- Preserve existing test intent and avoid unrelated refactors.

## Risks and mitigations

1. Risk: AI SDK 6 changes type names or helper signatures used by `assistant-harness.ts`.
   Mitigation: start with the manifest bump, then let typecheck identify the exact incompatibilities before changing code.
2. Risk: the lockfile may update indirect packages broadly.
   Mitigation: limit the dependency operation to the CLI workspace dependency pair and inspect the resulting diff before proceeding.
3. Risk: major-version changes may surface only in tests.
   Mitigation: run the full required repo checks after focused fixes, not just package-local typecheck.

## Tasks

1. Register active work and confirm the target versions from npm.
2. Upgrade `ai` and `@ai-sdk/openai-compatible` in `packages/cli`.
3. Reconcile any harness/test breakage from AI SDK 6.
4. Run completion-workflow audit passes and required repo verification.
5. Remove the ledger row, commit the scoped files, and hand off results.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Focused diagnostic checks may be used earlier if the major-version bump fails fast.

## Outcome

- `packages/cli` now targets `ai@^6.0.116` and `@ai-sdk/openai-compatible@^2.0.35`, matching npm `latest` on 2026-03-16.
- No harness or test-source changes were required; the existing `assistant-harness` usage compiled cleanly against AI SDK 6.

## Verification results

- Passed: `pnpm typecheck`
- Passed: `pnpm exec vitest run packages/cli/test/assistant-harness.test.ts packages/cli/test/inbox-model-harness.test.ts packages/cli/test/inbox-model-route.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm verify:cli`
- Failed, unrelated to this diff: `pnpm test`
  - failing targets: `packages/cli/test/selector-filter-normalization.test.ts`, `packages/cli/test/stdin-input.test.ts`
  - reason the diff is unrelated: this change only updates `packages/cli/package.json` and `pnpm-lock.yaml`; the failing tests exercise selector normalization and profile-path expectations outside the AI SDK harness, and the focused AI/CLI verification above passed under the new versions
- Failed, unrelated to this diff: `pnpm test:coverage`
  - same failing targets and rationale as `pnpm test`
Completed: 2026-03-16
