Goal (incl. success criteria):
- Fix DeepSec medium findings #4, #7, #8, and #9 with small local invariants.
- Leave #10 attachment evidence budgeting unresolved for separate discussion.
- Success means each fixed issue has focused regression coverage and touched packages typecheck.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and existing active plans.
- Keep fixes local to current owner boundaries; no new dependencies or broad abstractions.
- Prefer deterministic/idempotent state transitions over throttling or hidden retries.

Key decisions:
- Email sync replay should be made idempotent at the durable wake/envelope id boundary.
- Automation recurrence should use one explicit product minimum interval constant.
- Fresh hosted disconnected state should clear local OAuth credentials; stale hosted observations should not.
- User-authored assistant text may contain ordinary URLs/paths; metadata/artifact fields remain strict.

State:
- Complete; ready for scoped commit/closeout.

Done:
- Reviewed current DeepSec report and agreed to defer #10.
- Spawned xhigh explorer subagents for #4, #8, and #7/#9.
- Patched #4, #7, #8, and #9 with focused regression coverage.
- Ran security/privacy, coverage, and final-review audit subagents; addressed the #8 and #4 follow-up findings.
- Focused tests and typechecks passed for the touched owners.

Now:
- Close the active plan and preserve the unresolved #10 discussion for the user.

Next:
- Discuss #10 separately.

Open questions (UNCONFIRMED if needed):
- None for #4/#7/#8/#9.

Working set (files/ids/commands):
- `apps/web/app/api/settings/email/sync/route.ts`
- `apps/web/test/settings-email-sync-route.test.ts`
- `packages/core/src/automation.ts`
- `packages/core/test/assessment-automation-thresholds.test.ts`
- `packages/device-syncd/src/store/hosted-account-hydration.ts`
- `packages/device-syncd/test/store.test.ts`
- `packages/assistant-engine/src/assistant/input-store.ts`
- `packages/assistant-engine/test/assistant-input-store.test.ts`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/settings-email-sync-route.test.ts test/hosted-onboarding-member-channel-sync.test.ts test/settings-phone-sync-route.test.ts test/settings-telegram-sync-route.test.ts`
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/assessment-automation-thresholds.test.ts`
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/store.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-input-store.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
