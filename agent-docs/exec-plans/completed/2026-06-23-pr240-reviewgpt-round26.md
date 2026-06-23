# PR 240 ReviewGPT round 26 fixes

## Goal

Resolve the accepted ReviewGPT round 26 findings on PR 240 with minimal
complexity.

Success means:

- Retention-only processing enforces the 14-day raw media policy even when a
  pending assistant input would normally protect media during reply work.
- Upload-session cleanup deletes the singleton session only if it is still the
  same session that cleanup processed.
- Focused tests, typecheck, diff verification, CI, and the next ReviewGPT round
  pass or have documented unrelated blockers.

## Constraints

- Keep pending-input protections for ordinary idle maintenance.
- Do not add persisted cleanup state, schedulers, services, or broad locking.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Plan

1. Remove pending-input protections from retention-only checkpoint processing.
2. Replace raw singleton upload-session deletion with identity-aware deletion.
3. Add focused regression tests for both failure modes.
4. Run required verification.
5. Commit, push, check CI, and run the next ReviewGPT round.

## Progress

Implemented:

- Retention-only processing no longer passes pending assistant-input media
  protections into idle maintenance.
- Current upload-session cleanup now calls the existing identity-aware delete
  after cleanup obligations succeed.
- Added regressions for AI-denied retention-only deletion and stale
  upload-session cleanup preserving a newer session.

Passing:

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts --testNamePattern "retention-only processing preserves assistant wake"`
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm typecheck`
- `pnpm test:diff --base origin/main`

Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
