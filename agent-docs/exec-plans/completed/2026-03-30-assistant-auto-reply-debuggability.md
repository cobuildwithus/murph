# 2026-03-30 Assistant Auto-Reply Debuggability

## Goal (incl. success criteria)

- Make assistant auto-reply failures easier to diagnose without enabling unsafe foreground logging.
- Persist enough structured, redacted failure context that operators can distinguish provider quota failures, delivery failures, and retryable provider issues from one another.
- Show a clearer safe terminal summary for reply failures so `reply-failed cap_*` is no longer the only operator-visible clue.

## Constraints / Assumptions

- Keep secrets, raw headers, and sensitive identifiers out of terminal output and persisted artifacts.
- Preserve existing retry semantics for provider stall and connection-loss cases.
- Keep scope narrow to assistant auto-reply observability and direct tests.

## Key Decisions

- Reuse the existing auto-reply error artifact path instead of adding a second diagnostics store.
- Prefer stable safe summaries in terminal output over dumping raw provider error text.
- Add focused regression tests around failure classification, persisted artifacts, and terminal formatting.

## State

- Completed

## Done

- Confirmed the current failure for `cap_c2e986c7c2f03e56368e6f881d` was a Codex usage-limit exit surfaced only through `chat-error.json` and turn receipts.
- Read the repo routing, reliability, security, verification, completion-workflow, and coordination-ledger docs.
- Added structured auto-reply failure classification with safe summaries, redacted persisted artifact fields, and explicit `errorCode`/`safeDetails` terminal event support.
- Preserved delivery `outboxIntentId` correlation on wrapped auto-reply delivery failures without persisting raw delivery targets, migrated chat ids, or upstream error text.
- Added focused runtime and terminal-formatting regression coverage for delivery failures and provider quota failures.
- Ran the required simplify and final-review audit passes, then fixed the privacy regression and missing outbox-correlation gap they surfaced.

## Now

- Close the task plan and hand off the scoped result.

## Next

- Follow-up work, if requested: surface the same safe failure summaries in any higher-level status/doctor views that currently only read raw artifact payloads.

## Open Questions

- Whether any existing status/doctor surface should also read and summarize the richer auto-reply error artifact in a follow-up pass.

## Working Set (files / ids / commands)

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/cli/src/assistant/automation/{artifacts.ts,failure-observability.ts,reply.ts,shared.ts}`
- `packages/cli/src/run-terminal-logging.ts`
- `packages/cli/src/text/shared.ts`
- `packages/cli/test/{assistant-runtime.test.ts,assistant-cli.test.ts}`
- `pnpm exec vitest packages/cli/test/assistant-runtime.test.ts --maxWorkers 1 -t "failed Telegram delivery|provider quota failures with a safe summary"`
- `pnpm exec vitest packages/cli/test/assistant-cli.test.ts --maxWorkers 1 -t "reply failure"`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
