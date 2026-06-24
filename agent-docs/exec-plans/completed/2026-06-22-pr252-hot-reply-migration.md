# PR 252 Legacy Telegram Automation Finalize Fix

## Goal

Let the explicit v1 to v2 integration-ingest migration finalize legacy vaults
whose archived Telegram automations stored `route.deliveryTarget` as a numeric
frontmatter scalar.

## Constraints

- Keep the repair inside the explicit migration/finalize path.
- Do not add a runtime compatibility resolver or hosted reply-path mutation.
- Normalize only the legacy Telegram numeric route target that blocked final v2
  validation.
- Preserve strict v2 validation after migration.

## Plan

1. Confirm Telegram route targets are string-compatible at the provider and
   runtime boundaries.
2. Normalize safe-integer Telegram `route.deliveryTarget` values before the
   migration finalizes v2 metadata.
3. Preserve numeric-looking strings in the frontmatter writer so normalized
   targets round-trip as strings.
4. Add focused migration and frontmatter regression coverage.
5. Run required verification and audits.

## Verification

- `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/core-utilities.test.ts` passed.
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/wearable-storage-migration.test.ts` passed.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm test:smoke` passed.
- `pnpm test:diff packages/core/src/frontmatter.ts packages/core/src/integration-ingest-migration.ts packages/core/test/core-utilities.test.ts packages/core/test/wearable-storage-migration.test.ts` passed.
- After replacing a real-example numeric test value with a synthetic value, reran `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/core-utilities.test.ts`, `git diff --check`, and a touched-file privacy scan; all passed.
- Required audit passes completed: security/privacy found no medium-or-higher findings; coverage-write added negative Telegram target coverage; deep-review finding about finalization write ordering was fixed by staging automation normalizations before the v2 metadata bump.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
