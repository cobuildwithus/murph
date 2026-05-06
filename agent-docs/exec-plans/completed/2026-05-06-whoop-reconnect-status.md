# WHOOP Reconnect Status Fix

## Goal

Fix hosted device-sync reconnect so a successful OAuth callback for an existing disconnected provider account reactivates the connection instead of preserving `disconnected`.

## Scope

- `apps/web/src/lib/device-sync/prisma-store/connections.ts`
- focused hosted device-sync store/control-plane tests
- local dev database state inspection/repair for the current WHOOP row

## Constraints

- Do not expose provider tokens, raw OAuth state, member identifiers, or local paths.
- Preserve unrelated active worktree and ledger edits.
- Keep the fix provider-generic; WHOOP is the observed failing provider, but the status invariant applies to all OAuth reconnects.

## Verification

- Focused hosted device-sync test covering disconnected existing row plus successful OAuth reconnect.
- `pnpm typecheck`
- App/web focused verification if the worktree permits it; otherwise report unrelated blockers.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
