# PR 283 CI Index Name

## Goal

Get PR 283 green for the current CI failures in hosted web build/typecheck and package coverage lanes.

## Constraints

- Keep fixes narrowly scoped to stale schema/type/test contract assertions.
- Preserve the action-approval schema shape and migration semantics.
- Do not touch unrelated worktree changes.

## Root Cause

Vercel hosted web build fails during `prisma generate` because the mapped index name
`hosted_sensitive_action_challenge_member_id_approval_status_expires_at_idx`
exceeds Prisma/Postgres' 63-byte identifier limit.

Additional CI lanes were failing on stale test/type contracts from the same PR surface:
the hosted web approval page build, action-approval authorization hook shape, hosted-execution
export/route enumerations, runtime side-effect expectations, and hosted tool context test fixtures.

## Plan

1. Shorten the mapped index name in `apps/web/prisma/schema.prisma`.
2. Shorten the matching `CREATE INDEX` name in the migration SQL.
3. Fix the hosted web approval build/typecheck issues without changing approval semantics.
4. Update stale package/runtime test expectations for new action-approval and vault-file-send fields.
5. Run focused hosted-web/package checks plus root typecheck, then push the PR branch.

## Verification

- Passed: `pnpm --dir apps/web prisma:generate`
- Passed: `pnpm --dir apps/web release:production:migrate`
- Passed: `pnpm --dir apps/web build`
- Passed: `pnpm --dir apps/web lint`
- Passed: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-onboarding-privacy-foundation-migration.test.ts`
- Passed: `pnpm --dir apps/web verify`
- Passed: `pnpm --dir packages/hosted-execution test`
- Passed: `pnpm --dir packages/hosted-execution test:coverage`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts`
- Passed: `pnpm --dir packages/assistant-runtime test:coverage`
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-computer-tools.test.ts test/assistant-codex-connected-apps.test.ts test/assistant-codex-runtime.test.ts test/assistant-protocol-index-planning.test.ts`
- Passed after local package declaration builds: `pnpm typecheck`
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
