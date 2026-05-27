# Device-sync yield follow-ups

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Fix final edge cases found after the provider-yield hardening audit.

## Success criteria

- Junction request abort/yield errors are rethrown instead of wrapped as provider API failures.
- OAuth provider error-body parsing preserves abort/yield cancellation.
- Junction best-effort source projection does not swallow foreground-yield cancellation.
- OAuth token refresh rotation is not interrupted by foreground-yield abort after the request starts; yield is honored before refresh and after token persistence.
- Hosted yielded retry wake is based on the actual yield time so long passes do not schedule an already-stale retry.
- Focused tests/typecheck pass, or unrelated dirty-worktree blockers are documented.

## Scope

- `packages/device-syncd/src/providers/request-abort.ts`
- `packages/device-syncd/src/providers/shared-oauth.ts`
- `packages/device-syncd/src/providers/junction-client.ts`
- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/src/service.ts`
- Focused device-sync tests
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- Focused hosted maintenance tests

## Constraints

- Preserve unrelated dirty worktree edits.
- Do not log raw provider payloads, credentials, local paths, account identifiers, or direct personal identifiers.
- Keep the fix narrow; do not redesign job completion or sync-state fencing in this follow-up.

## Progress

- Fixed Junction caller aborts being wrapped as `JUNCTION_API_REQUEST_FAILED`.
- Fixed shared OAuth error-body parsing so abort/yield is rethrown during body reads.
- Fixed Junction direct-webhook source projection so foreground yield is not swallowed by best-effort warning handling.
- Kept foreground-yield abort out of OAuth refresh-token rotation once refresh starts; yield is checked before refresh and after token persistence.
- Fixed hosted yielded retry scheduling to use actual yield time instead of the original wake timestamp.

## Verification

- Passed:
  - `pnpm --dir packages/device-syncd test service.test.ts shared-oauth.test.ts junction-provider.test.ts`
  - `pnpm --dir packages/assistant-runtime test hosted-runtime-maintenance.test.ts`
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm --dir packages/device-syncd test:coverage`
  - `git diff --check`
- Passed inside diff verifier before unrelated failure:
  - `packages/assistant-runtime typecheck`
  - `packages/device-syncd typecheck`
- Blocked by unrelated dirty hosted orchestration work:
  - `pnpm test:diff packages/device-syncd packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`
  - `pnpm typecheck`
  - Failing targets mention `ignoredWorkspaceWakeKey` missing from hosted runtime demand/workflow types in `packages/hosted-orchestrator-temporal` and `apps/web`.
Completed: 2026-05-27
