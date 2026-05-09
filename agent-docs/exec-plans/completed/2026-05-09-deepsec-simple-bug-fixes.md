# DeepSec simple bug fixes

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Investigate and fix four remaining DeepSec BUG findings with the smallest durable changes:
  inherited unit alias lookups, raw ingest `__proto__` preservation, bounded inbox attachment filenames, and status-only experiment onboarding applies.

## Success criteria

- Each confirmed finding has a focused regression test.
- Fixes are local, simple, and do not introduce new architecture.
- Focused package tests pass; typecheck is attempted per repo policy.
- DeepSec records/report are updated only for findings proven fixed.

## Scope

- In scope: `packages/health-metrics`, `packages/importers`, `packages/inboxd`, `packages/vault-usecases`, focused tests, and matching `.deepsec` revalidation metadata.
- Out of scope: unrelated DeepSec findings and broader experiment CLI typed-surface work.

## Constraints

- Technical constraints: preserve current public APIs and existing normalization semantics except the flagged edge cases.
- Product/process constraints: preserve unrelated dirty worktree edits; do not expose local personal identifiers in generated metadata.

## Risks and mitigations

1. Risk: touching `experiment-journal-vault.ts` overlaps an active plan-only experiment CLI row.
   Mitigation: keep the change to the existing empty-patch predicate and one focused test; no CLI surface changes.
2. Risk: filename truncation could make names less readable or collide.
   Mitigation: preserve extension, use a deterministic hash suffix only when truncation is needed, and cover it with tests.

## Tasks

1. Done: inspected each finding and nearby tests.
2. Done: applied minimal fixes and regression coverage.
3. Done: ran focused package tests and typecheck attempts.
4. Done: updated DeepSec verdicts/report for the four proven fixes.
5. Now: close the plan with a scoped commit if the worktree permits.

## Decisions

- Use null-prototype/plain-object-owned operations for JSON/object maps instead of ad hoc prototype-sensitive indexing.
- Keep filename bounding in the shared `sanitizeFileName` helper so persistence callers inherit the limit.

## Verification

- Passed: `pnpm --filter @murphai/health-metrics exec vitest run --config vitest.config.ts --no-coverage test/index.test.ts`
- Passed: `pnpm --filter @murphai/importers exec vitest run --config vitest.config.ts --no-coverage test/garmin-provider-coverage.test.ts`
- Passed: `pnpm --filter @murphai/inboxd exec vitest run --config vitest.config.ts --no-coverage test/inboxd-shared-barrels-coverage.test.ts`
- Passed: `pnpm --filter @murphai/vault-usecases exec vitest run --config vitest.config.ts --no-coverage test/experiment-onboarding-schedule.test.ts`
- Passed: `pnpm --filter @murphai/health-metrics typecheck`
- Passed: `pnpm --filter @murphai/importers typecheck`
- Passed: `pnpm --filter @murphai/inboxd typecheck`
- Passed in root workspace typecheck before unrelated app failure: `packages/vault-usecases typecheck`
- Passed: `pnpm --filter @murphai/health-metrics test:coverage`
- Passed: `pnpm --filter @murphai/inboxd test:coverage`
- Passed: `pnpm --filter @murphai/vault-usecases test:coverage`
- Failed, unrelated current-package baseline: `pnpm --filter @murphai/importers test:coverage` fails existing deletion-normalization expectations outside this task's raw-ingest file.
- Failed, unrelated reverse-dependent baseline: `bash scripts/workspace-verify.sh test:diff <task paths>` stops in `packages/cli typecheck` on existing `@murphai/setup-cli/*` export-resolution errors.
- Failed, unrelated app baseline: `pnpm typecheck` reaches the app layer and fails in `apps/cloudflare/test/browser-vault-refresh-coordinator.test.ts` because `deferredCheckpointRequired` is optional in a test fixture but required by `RunnerStateRecord`.
- Passed: `pnpm deepsec report --project-id murph`
- Passed: `pnpm deepsec metrics --project-id murph --min-severity BUG`
- Passed: DeepSec JSON validation for `.deepsec/data/murph/files` and `.deepsec/data/murph/reports`.
- Passed: `git diff --check` for the task paths.
Completed: 2026-05-09
