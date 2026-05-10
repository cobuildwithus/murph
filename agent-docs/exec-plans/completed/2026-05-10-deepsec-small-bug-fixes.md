# DeepSec Small Bug Fixes

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

Fix four small DeepSec bug findings with narrow owner-seam changes and focused regression tests.

## Success Criteria

- Health Commons source findings fail validation when they reference an existing artifact owned by a different source.
- `hosted-local run -- <command>` treats child command flags after `--` as opaque.
- Assessment response imports preserve the caller-supplied occurrence timestamp by mapping it into the core assessment recorded timestamp.
- Strava snapshot parsing rejects malformed optional collection fields instead of silently dropping them.
- Focused tests cover each invariant.
- Required verification and completion audits pass, or unrelated blockers are documented.

## Scope

- `packages/health-commons/src/catalog.ts`
- `packages/health-commons/test/catalog-coverage.test.ts`
- `packages/hosted-local-harness/src/cli.ts`
- Hosted-local harness tests if present or the closest existing owner test surface.
- `packages/importers/src/assessment/import-assessment-response.ts`
- `packages/importers/src/assessment/core-port.ts`
- `packages/core/src/assessment/storage.ts`
- Importers/core assessment tests.
- `packages/importers/src/device-providers/strava.ts`
- Strava importer tests.

## Constraints

- Keep fixes at owner boundaries, not scattered call-site patches.
- Preserve unrelated dirty worktree edits and active ledger rows.
- Avoid broad redesigns or compatibility shims beyond the narrow existing public input aliases.

## Tasks

1. [x] Add Health Commons artifact ownership assertion.
2. [x] Split hosted-local parent args from child args before profile parsing.
3. [x] Map assessment importer `occurredAt` into core `recordedAt`.
4. [x] Validate Strava optional collections in the parser seam.
5. [x] Run focused verification and required audits.

## Verification

- Passed: `pnpm --dir packages/health-commons exec vitest run --config vitest.config.ts --no-coverage test/catalog-coverage.test.ts`
- Passed: `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/input-validation.test.ts test/strava.test.ts`
- Passed: `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/hosted-local-run-cli.test.ts`
- Passed: `pnpm typecheck`
- Passed: `pnpm test:smoke`
- Passed: `pnpm --dir packages/health-commons exec vitest run --config vitest.config.ts --no-coverage test/runtime.test.ts`
- Passed: `pnpm --dir packages/health-commons test`
- Passed: `pnpm --dir packages/health-commons typecheck`
- Passed: `pnpm --dir packages/importers test:coverage`
- Passed: `pnpm --dir packages/importers typecheck`
- Passed: `pnpm --dir packages/hosted-local-harness typecheck`
- Blocked: `bash scripts/workspace-verify.sh test:diff packages/health-commons/src/catalog.ts packages/health-commons/test/catalog-coverage.test.ts packages/health-commons/test/runtime.test.ts packages/hosted-local-harness/src/cli.ts scripts/hosted-local-run-cli.test.ts packages/importers/src/assessment/core-port.ts packages/importers/src/assessment/import-assessment-response.ts packages/importers/src/device-providers/strava.ts packages/importers/test/input-validation.test.ts packages/importers/test/strava.test.ts` failed in unrelated reverse-dependent `packages/cli` typecheck because dirty inbox runtime-store interface changes require `getAttachment` on a clean `packages/cli/test/inbox-cli.test.ts` mock.
- Blocked: `pnpm --dir packages/health-commons test:coverage` executed all Health Commons tests successfully but failed existing global coverage thresholds.
- Security/privacy audit: no findings.
- Coverage-write audit: no file changes; initial diff-aware coverage blocker was a stale Health Commons generated-index expectation. The stale expectation was fixed by updating the test to assert the currently published `deep-sleep-minutes` route instead of hidden draft `sleep-quality`.
- Final completion audit: no findings.
Completed: 2026-05-10
