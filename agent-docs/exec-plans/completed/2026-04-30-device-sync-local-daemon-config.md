# Local Device Sync Daemon Config Error

## Goal

Make local `vault-cli device ...` failures actionable when no local provider credentials are configured, and stop labeling WHOOP `energy-burned` as active calories.

Success criteria:
- `device provider list` / `device account list` report missing local provider credentials directly instead of a generic daemon start/health wrapper when the managed daemon startup log contains that root cause.
- Managed daemon status remains truthful when no `launcher.json` exists.
- WHOOP `energy-burned` normalizes as total energy/calories rather than `activeCalories`.
- Focused tests cover the changed CLI/device and wearable-normalization behavior.

## Constraints

- Preserve local daemon secret handling and private `.runtime/operations/device-sync/**` file modes.
- Do not expose real credentials, local home paths, or operator identifiers in tests/logs/docs.
- Hosted WHOOP OAuth remains separate from the local daemon credential source.

## Scope

Touched files:
- `packages/operator-config/src/device-daemon.ts`
- `packages/operator-config/test/device-daemon-runtime.test.ts`
- `packages/cli/src/commands/wearables.ts`
- `packages/cli/test/device-daemon.test.ts`
- `packages/importers/src/device-providers/metric-catalog.ts`
- `packages/importers/src/device-providers/provider-descriptors.ts`
- `packages/importers/test/canonical-wearables.test.ts`
- `packages/query/src/wearables.ts`
- `packages/query/src/wearables/source-health.ts`
- `packages/query/src/wearables/types.ts`
- `packages/query/test/wearables-canonical-records.test.ts`
- `packages/query/test/wearables-normalized-surfaces.test.ts`
- `packages/query/test/wearables-source-health-final.test.ts`
- `packages/inbox-services/tsconfig.typecheck.json`
- `tsconfig.base.json`

Deliberately excluded overlapping unrelated active edits in `packages/query/src/browser-replica/build.ts`.

## Verification

Passed:
- `pnpm --dir packages/operator-config exec vitest run test/device-daemon-runtime.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/cli exec vitest run test/device-daemon.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/importers exec vitest run test/canonical-wearables.test.ts test/metric-catalog-coverage.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/query exec vitest run test/wearables-normalized-surfaces.test.ts test/wearables-canonical-records.test.ts test/wearables-source-health-final.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/importers typecheck`
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/inbox-services typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm typecheck`
- `git diff --check`
- `bash scripts/workspace-verify.sh test:diff <touched paths>`; reverse-dependency verification included `apps/cloudflare verify` and `apps/web verify`.
- After coverage-write added CLI daemon coverage: `pnpm --dir packages/cli exec vitest run test/device-daemon.test.ts --config vitest.config.ts --no-coverage` and `git diff --check -- packages/cli/test/device-daemon.test.ts`.

## Audit

Completion workflow requires security/privacy review, coverage-write, and task-finish review because this touches local health/device runtime state and CLI behavior.

- Security/privacy review: no findings.
- Coverage-write: added CLI package daemon tests for missing-provider preflight and startup-log mapping.
- Task-finish review: no blocking findings.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
