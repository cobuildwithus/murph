# Automation Notification Architecture

## Goal

Apply the returned ChatGPT patch that splits scheduled automations onto a dedicated notification-turn path, updates the automation contract from `prompt` to `instructions`, removes stored cron `deliverResponse`, and preserves only explicit continuity behavior needed for notification jobs.

## Scope

- Apply the downloaded `automation_notification_full.patch` if it still matches the current tree.
- Keep changes limited to the patch-touched assistant engine, contracts, core, query, and CLI files.
- Run the required verification and completion workflow for this repo task.
- Run the recursive same-thread follow-up helper after verification/audits complete.

## Constraints

- Preserve unrelated worktree history and the existing active coordination row.
- Keep `[DEV]` behavior intact, per the watched-thread instructions captured in the export.
- Treat the supplied patch as bounded behavioral intent, not authority to widen scope.
- Commit only the exact touched paths for this task.

## Verification Plan

Because this patch touches multiple workspace packages, use:

1. `pnpm typecheck`
2. `pnpm test:diff <touched paths>` if that lane truthfully covers this slice; otherwise fall back to the edited owner coverage commands required by the verification doc
3. `coverage-write` audit pass on `gpt-5.4-mini`
4. `task-finish-review` audit pass

## Notes

- `git apply --check` succeeds for the downloaded patch against the current tree.
- The patch touches assistant-engine, contracts, core, query, and CLI automation surfaces and adds `packages/assistant-engine/src/assistant/notification-turn.ts`.
- Final review found and this task fixed a duplicate-send risk in `notification-turn`: notification delivery now persists the assistant turn/session before outbound delivery and uses the saved session for dispatch.
- Added `packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts` to lock the persist-before-deliver ordering.
- Verification completed successfully with `pnpm typecheck`, `pnpm --dir packages/assistant-engine test`, and `pnpm test:diff packages/assistant-engine packages/contracts packages/core packages/query packages/cli`.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
