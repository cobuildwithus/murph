# Keep Telegram auto-replies pending across Codex usage-limit failures

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Preserve pending Telegram auto-reply captures when the local Codex provider exits on a usage-limit or similar capacity failure, so restarting `murph run` under a different Codex profile can retry the same inbound message instead of skipping it permanently.

## Success criteria

- A provider usage-limit failure no longer advances `autoReplyScanCursor`.
- The failed capture remains eligible for retry on the next automation run.
- Failure observability stays intact with the existing safe summary and error artifact.
- The change stays scoped to assistant auto-reply retry classification and focused regression tests.

## Scope

- In scope:
- Assistant auto-reply failure classification for provider capacity failures in `packages/assistant-engine/src/assistant/automation/reply.ts`.
- Focused regression coverage in `packages/cli/test/assistant-runtime.test.ts`.
- Out of scope:
- Connector backfill/import logic in `packages/inboxd`.
- Broader assistant session recovery or provider failover redesign.

## Constraints

- Technical constraints:
- Keep the retry model simple: failed-but-retryable-for-operator-recovery captures should remain pending without introducing a new persistence surface.
- Preserve existing error artifacts and terminal-safe summaries.
- Avoid changing unrelated dirty work already present in the repository.
- Product/process constraints:
- Follow the standard repo completion workflow, including verification, final audit, and a scoped commit.

## Risks and mitigations

1. Risk: Retrying the same capture forever on a genuinely permanent provider error.
   Mitigation: Limit the behavior change to usage-limit/quota/rate-capacity failures rather than all provider failures.
2. Risk: Regressing existing failure observability by converting failures into silent skips.
   Mitigation: Keep the `capture.reply-failed` event and error artifact path; only change cursor advancement and scan stop behavior.

## Tasks

1. Add a narrow helper for provider capacity failures used by auto-reply failure classification.
2. Change usage-limit/quota failures to stop the scan without advancing the reply cursor.
3. Update focused assistant runtime tests to assert the pending-retry behavior.
4. Run required verification, complete final review, and close the plan.

## Decisions

- Keep the fix inside auto-reply failure classification instead of adding a second backlog queue or connector replay path, because the existing cursor-based retry model already fits the desired restart behavior.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm vitest packages/cli/test/assistant-runtime.test.ts`
- Expected outcomes:
- TypeScript stays green and the focused assistant runtime suite covers the new usage-limit retry behavior.
Completed: 2026-04-07
