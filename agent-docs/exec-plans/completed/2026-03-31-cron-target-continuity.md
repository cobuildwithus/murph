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

## Status

- Done:
  - session resolution now preserves explicit null route clears and supports explicit session-id rebinding
  - cron target retargeting preserves continuity by default and only resets on `--resetContinuity`
  - daemon and incur CLI surfaces expose the reset flag cleanly
  - tests cover preserved continuity, explicit reset, daemon wiring, and rebinding safety
- Verification:
  - `pnpm typecheck` passed
  - focused assistant/daemon Vitest suite passed
  - direct CLI smoke passed for preserved continuity and explicit reset
  - `pnpm test` failed for a pre-existing docs guard on unrelated `agent-docs/**` edits requiring `agent-docs/index.md`
  - `pnpm test:coverage` failed in unrelated existing coverage/test instability after progressing into the wider suite
Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
