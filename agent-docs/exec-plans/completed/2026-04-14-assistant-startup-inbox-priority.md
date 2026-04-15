Goal (incl. success criteria):
- Make assistant automation scan inbox/reply work before due cron jobs so startup catch-up messages are handled first.
- Keep cron execution functional in the same continuous run and preserve single-turn serialization per vault.

Constraints/Assumptions:
- Keep the fix minimal and localized to pass ordering.
- Do not introduce parallel turn execution.
- Preserve unrelated worktree edits.

Key decisions:
- Reorder `runAssistantAutomationPass` so recovery/scan happen before cron.
- Add focused regression coverage for pass ordering rather than broader behavior changes.

State:
- completed

Done:
- Confirmed the observed startup delay came from an overdue cron automation running before Telegram catch-up.
- Traced the current pass ordering and relevant tests.
- Reordered assistant automation passes so inbox recovery/scanning run before due cron jobs.
- Added focused run-loop coverage for the new ordering.
- Verified with `pnpm typecheck` and `pnpm --dir packages/assistant-engine test:coverage`.

Now:
- None.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/automation/run-loop.ts`
- `packages/assistant-engine/test/assistant-automation-runtime.test.ts`
- `pnpm --dir packages/assistant-engine test:coverage`
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
