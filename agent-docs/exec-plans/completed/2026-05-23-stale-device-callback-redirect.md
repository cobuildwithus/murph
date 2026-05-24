# Stale device callback redirect

Status: completed
Created: 2026-05-23
Updated: 2026-05-23

## Goal

- Fix stale hosted Junction/Garmin callback handling after the user disconnects a seeded connection so the account remains disconnected, but the browser is redirected back through the safe completion surface instead of seeing raw callback failure HTML.

## Success criteria

- Stale disconnected seeded callbacks still fail closed and do not call provider completion or reactivate the account.
- Seeded callbacks that race with disconnect after provider completion cannot persist credentials or reactivate the hosted connection.
- Device-sync callback errors raised after OAuth state consumption carry safe `returnTo`, provider, and connect-source metadata.
- Hosted callback route redirects stale disconnected callback errors to the connect completion page when the stored `returnTo` is safe.
- Hosted callback fallback HTML does not print raw `DeviceSyncError` messages when a redirect target is unsafe.
- Focused public-ingress and hosted-web tests cover the regression.

## Scope

- In scope: shared public-ingress callback error context, guarded seeded-account persistence, hosted callback route tests, and narrow completion/error redirect proof.
- Out of scope: changing Junction account identity rules, disconnect semantics, provider token revoke behavior, or adding a new user-visible callback status.

## Constraints

- Technical constraints: preserve fail-closed state/owner checks, avoid provider/user identifiers in redirect params or logs, do not revive disconnected accounts from stale callbacks.
- Product/process constraints: follow hosted device-sync control-plane rules; preserve unrelated active ledger rows and worktree edits.

## Risks and mitigations

1. Risk: masking a real account-takeover or stale callback issue as success.
   Mitigation: keep `CONNECTION_ALREADY_DISCONNECTED` as a non-retryable error and only attach sanitized redirect context.
2. Risk: leaking connection ids or provider account ids to browser redirects.
   Mitigation: reuse existing callback redirect helpers and assert route output omits raw connection ids.

## Tasks

1. Reproduce/static trace the stale callback path.
2. Attach safe callback context to the disconnected seeded-account error path.
3. Add focused shared public-ingress and hosted route regressions.
4. Run scoped tests, typecheck, and direct callback proof.
5. Run required audits, close plan, and commit.

## Decisions

- Preserve `CONNECTION_ALREADY_DISCONNECTED` as an error; improve browser handling by retaining existing safe return metadata.
- Preserve ordinary disconnected-account reconnect behavior; apply the write-time reject only when callback state names the seeded account that must still be active.

## Verification

- Commands to run: focused Vitest files for device-sync public ingress and hosted callback route, `pnpm typecheck`, and `pnpm test:diff` for touched files if practical.
- Expected outcomes: tests pass, no raw identifiers in redirects, stale callback does not call provider completion or reactivate disconnected state.
- Current results:
  - Passed: focused `packages/device-syncd` public-ingress Vitest file.
  - Passed: focused hosted-web device-sync callback route and Prisma connection store Vitest files.
  - Passed: `pnpm --dir packages/device-syncd typecheck`.
  - Passed: `pnpm --dir packages/device-syncd test:coverage`.
  - Passed: `pnpm --dir apps/web typecheck`.
  - Passed with unrelated warnings: `pnpm --dir apps/web lint`.
  - Passed: `git diff --check`.
  - Passed: added-line privacy scan for paths, auth headers, bearer tokens, secret keys, and emails.
  - Blocked by unrelated pre-existing raw-log guard finding: `pnpm typecheck` and scoped `test:diff`.
Completed: 2026-05-23
