# Core telemetry policy naming cleanup

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Finish the dense device telemetry policy naming cleanup in `packages/core` so current API names describe both dense sample rows and observation events, while deprecated sample-oriented names remain compatible.

## Success criteria

- `DenseDeviceTelemetryPolicyInput` accepts `allowDenseDebugTelemetry?: boolean`.
- Deprecated `allowDenseDebugSamples` and `denseSamplePolicy` aliases still work for existing callers.
- The policy emits `VAULT_DENSE_DEVICE_TELEMETRY_NOT_ALLOWED` for blocked dense telemetry writes, with legacy error-code compatibility preserved where the codebase expects it.
- Focused core tests cover the current name and compatibility aliases.
- Required package verification and completion audits pass or have documented unrelated blockers.

## Scope

- In scope: `packages/core` policy implementation, public exports/types, focused core tests, and any reverse-dependent test expectation that directly asserts the renamed core error code.
- Out of scope: changing storage shape, importer/provider behavior, default dense telemetry policy semantics, or broad wearable cleanup.

## Constraints

- Technical constraints: keep the change narrow and additive; avoid weakening fail-closed dense telemetry guards.
- Product/process constraints: do not expose raw health payloads, local paths, secrets, or direct personal identifiers in docs, tests, logs, or handoff.

## Risks and mitigations

1. Risk: callers break because old sample-oriented names disappear.
   Mitigation: keep aliases and focused compatibility tests.
2. Risk: error-code rename loses useful compatibility.
   Mitigation: add a current code while preserving the legacy code as a compatibility alias.

## Tasks

1. Locate dense telemetry policy implementation and existing tests.
2. Add current telemetry input/error names with compatibility aliases.
3. Add or update focused core tests.
4. Run required verification and completion audits.
5. Close the plan and commit the scoped change.

## Decisions

- Use additive aliases only; do not change dense telemetry defaults or storage behavior.
- Preserve the legacy sample-specific error code as `details.legacyCode` and `details.codeAliases` while making `error.code` the current telemetry-specific code.

## Verification

- `pnpm --dir packages/core exec vitest run --config vitest.config.ts test/device-import.test.ts` passed.
- `pnpm --dir packages/importers exec vitest run --config vitest.config.ts test/device-providers.test.ts` passed.
- `pnpm --dir packages/core typecheck` passed.
- `pnpm --dir packages/importers typecheck` passed.
- `pnpm --dir packages/core test:coverage` passed.
- `pnpm --dir packages/importers test:coverage` passed.
- `pnpm test:smoke` passed.
- `git diff --check` on scoped paths passed.
- `pnpm typecheck` failed after `packages/core` and `packages/importers` passed because an unrelated active `packages/query/src/query-projection.ts` edit is missing `MAX_WEARABLE_PROVIDER_SCOPE_COMBINATIONS`.
- Required `security-privacy-review` and `task-finish-review` found no findings.
- Required `coverage-write` added mixed current/deprecated alias coverage in `packages/core/test/device-import.test.ts`.
Completed: 2026-05-27
