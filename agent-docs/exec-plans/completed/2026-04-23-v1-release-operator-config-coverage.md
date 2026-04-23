# V1 Release Operator Config Coverage

## Goal

Restore the v1 release gate by covering the operator-config device CLI contract file that failed per-file coverage during `pnpm release:check`.

## Scope

- Add focused tests for `packages/operator-config/src/device-cli-contracts.ts`.
- Do not change production release behavior or package metadata.

## Verification

- `pnpm --dir packages/operator-config exec vitest run test/device-daemon-runtime.test.ts --config vitest.config.ts --coverage`
- `pnpm release:check`

## Notes

- The earlier v1 cleanup batch already set the package line to `1.0.0`.
- The repo release script cannot rerun an exact `1.0.0` version bump once the version is already set, so release artifact generation and tagging will follow the script's remaining steps manually after the gate is green.
Status: completed
Updated: 2026-04-23
Completed: 2026-04-23
