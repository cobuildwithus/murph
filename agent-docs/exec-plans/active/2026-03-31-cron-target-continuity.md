## Goal

Preserve assistant session continuity when a cron job is retargeted to a new delivery audience, as long as the downstream session and delivery layers explicitly support rebinding that saved session to the new route.

## Why

The first cron target CLI landed with safe-by-default continuity resets on audience change. Product intent is different: a cron moving from Telegram to email should usually keep the same assistant session. That only works if explicit session-id resumes can rebind the stored routing metadata cleanly and clear stale thread/participant fields when the new audience omits them.

## Scope

- Verify current session-resolution and delivery behavior for explicit session-id rebinding.
- Change cron target mutation defaults to preserve `sessionId` and `alias`, with an explicit reset flag for opt-out.
- Thread explicit rebinding support through assistant message session resolution for cron-driven sends.
- Add direct tests proving the rebind works and that reset remains available on demand.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- direct CLI smoke for cross-channel cron retarget with preserved continuity
