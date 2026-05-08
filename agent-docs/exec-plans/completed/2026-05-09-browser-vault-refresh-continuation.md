# Browser-Vault Refresh Continuation

## Goal

Remove the subtle dependency between foreground invocation lock release and browser-vault refresh scheduling by ensuring a refused immediate refresh always gets a short continuation alarm.

## Scope

- `apps/cloudflare/src/browser-vault-refresh/coordinator.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/user-runner.ts`
- Focused Cloudflare runner tests for browser-vault refresh scheduling.

## Constraints

- Keep the fix small and local to refresh coordination.
- Preserve foreground-work exclusion for actually starting detached refreshes.
- Do not broaden browser-vault refresh authority, checkpoint ownership, or runner lifecycle behavior.
- Preserve unrelated active worktree edits.

## Verification

- Focused Cloudflare tests covering continuation scheduling while foreground work is still active, stale alarm handling, abort signal propagation, and runner alarm integration.
- Cloudflare-focused type/test verification as time and worktree state allow.

## State

Active. Final review found that a post-foreground drain could start the refresh before
the short continuation alarm fires, leaving a stale continuation alarm. The
coordinator now asks the runner to restore its stored runtime alarm after that
early start path. Follow-up review found stale/past DO alarms and abort propagation
as adjacent race risks; the fix now ignores past alarms and threads refresh abort
signals into the container refresh path.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
