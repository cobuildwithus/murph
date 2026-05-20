# Device Sync Diagnostics Review Fixes

## Goal

Address post-commit review findings for device-sync diagnostics while preserving
rich, useful provider failure logging for debugging.

## Scope

- `packages/device-syncd/src/providers/**`
- focused provider tests
- hosted runtime redacted-log validators and focused tests

## Constraints

- Keep actual provider error reasons after existing redaction/sanitization.
- Do not log raw tokens, client secrets, auth headers, raw provider paths, raw
  query values, request bodies, response bodies, or provider account IDs.
- Preserve unrelated dirty worktree edits.

## Plan

1. Fix Oura and Strava refresh-token `invalid_grant` account status handling.
2. Add the missing WHOOP connect-time profile endpoint kind.
3. Keep full diagnostic redacted logs by allowing safe body-field metadata keys
   and raising the bounded redacted JSON key cap.
4. Add focused tests and run targeted verification.

## Verification

- `pnpm --dir packages/device-syncd typecheck` passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir apps/web typecheck:prepared` passed.
- `pnpm --dir packages/device-syncd test -- oura-provider.test.ts strava-provider.test.ts whoop-provider.test.ts shared-oauth.test.ts hosted-runtime.test.ts service.test.ts` passed; the package runner executed the full device-syncd suite.
- `pnpm --dir packages/hosted-execution test -- hosted-runtime-control.test.ts` passed; the package runner executed the full hosted-execution suite.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-workspace-store.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts` passed.
- `git diff --check -- <review-fix files>` passed.

## State

- Review fixes are implemented and ready for a scoped commit.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
