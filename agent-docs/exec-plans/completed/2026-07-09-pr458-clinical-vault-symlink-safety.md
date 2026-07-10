# PR 458 Clinical Vault Symlink Safety Fix

## Goal

Fix the accepted PR 458 ReviewGPT round-26 finding that clinical FHIR import
reads can follow symlinks outside the vault.

## Constraints

- Use the existing vault path-safety primitive from `@murphai/core`.
- Preserve existing manifest byte, resource byte, hash, and count checks.
- Keep the importer fail-closed without adding a new path-policy layer.

## Working Set

- `packages/importers/src/clinical-records/index.ts`
- `packages/importers/test/clinical-records.test.ts`

## Plan

1. Replace the importer-local vault-relative path join with
   `resolveVaultPathOnDisk`.
2. Keep read/stat behavior behind the existing manifest and raw-resource bounds.
3. Add regressions for symlinked manifest and symlinked resource page paths.
4. Run focused importer tests, typecheck, release smoke, commit, push, and rerun
   the ReviewGPT PR loop.

## Verification

- `pnpm --dir packages/importers test -- clinical-records.test.ts` passed.
- `pnpm typecheck` passed.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS=50% pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/release-script-coverage-audit.test.ts` passed.
- `git diff --check` passed.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm test:diff packages/importers/src/clinical-records/index.ts packages/importers/test/clinical-records.test.ts` passed affected package tests, importer tests, and Cloudflare verify, then failed only in parallel `apps/web` dev smoke with local Next dev exit code 130 while web test/lint/build passed.
- `env MURPH_HOSTED_WEB_SMOKE_PREPARED_LOCAL_ENV=1 pnpm --dir apps/web dev:smoke` passed.
- `env MURPH_VERIFY_STEP_PARALLEL=0 pnpm --dir apps/web verify` passed.

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
