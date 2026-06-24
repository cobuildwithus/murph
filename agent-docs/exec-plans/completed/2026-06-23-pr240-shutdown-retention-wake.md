# PR 240 shutdown retention wake

## Goal

Fix the ReviewGPT round-12 shutdown edge case for PR #240: if hosted idle
maintenance is interrupted by shutdown while inbox media retention is due, the
checkpoint must preserve or recreate an `inbox_media_retention` wake instead of
clearing the only automatic cleanup trigger.

Success criteria:

- Shutdown before or during retention does not permanently drop the media
  retention wake.
- Foreground wake interruption behavior stays unchanged and remains prompt-first.
- No new scheduler, persisted state owner, or background service.
- Focused assistant-runtime tests and typecheck pass before push.

## Constraints

- Keep the fix inside the existing hosted idle-maintenance/wake path.
- Reuse the existing bounded retention retry wake.
- Avoid touching unrelated hosted runner, Cloudflare, or Temporal ownership.

## Plan

1. Verify the shutdown/interruption call path and existing wake selection.
2. Add the smallest production change that carries a retention retry wake on
   shutdown interruption.
3. Add regression coverage for early and mid-retention shutdown.
4. Run focused tests, typecheck, commit via `scripts/finish-task`, push, then
   rerun ReviewGPT and poll CI.

## Outcome

- Added shutdown retry wake preservation inside existing hosted idle maintenance.
- Preserved foreground wake interruption behavior.
- Added regression coverage for pre-retention shutdown, mid-retention shutdown,
  competing assistant wakes, and projected-wake passes before shutdown.
- Verification passed for assistant-runtime focused tests and typecheck.
- Repo diff verification reached a pre-existing local Cloudflare synthetic-home
  Corepack cache failure outside this PR's files.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
