Goal (incl. success criteria):
- Ensure hosted signup installs a daily managed onboarding follow-up automation that starts after the signup day.
- The scheduled instructions must check assistant onboarding state through the onboarding CLI context command, ask only while onboarding is still open, and archive the automation permanently once onboarding is complete or declined.
- Success means the existing signup welcome seed keeps routing/idempotency behavior, tests assert the new instructions, and the daily first occurrence remains deferred until the next local day.

Constraints/Assumptions:
- Reuse the existing hosted signup welcome follow-up seed and canonical automation/cron runtime; do not add a new scheduler or web cron.
- Preserve route validation and archived-record behavior in `upsertAssistantCronAutomation`.
- Keep automatic outbound copy prompt-driven, not hard-coded final user text.
- Preserve unrelated working-tree edits and active ledger rows.

Key decisions:
- Update the existing `finish-onboarding-followup` automation instructions rather than adding another automation.
- Keep `firstOccurrencePolicy: "after-current-local-day"` as the signup-day skip mechanism.

State:
- Complete; ready to archive and commit.

Done:
- Confirmed current runtime already seeds `finish-onboarding-followup` after successful signup welcome delivery.
- Confirmed first occurrence is deferred to the next local day.
- Updated the managed automation instructions to use onboarding resume context, archive after completion, and ask only for the next unresolved onboarding step.
- Updated focused runtime and hosted-local test expectations.
- Ran security/privacy and coverage audit passes; security found no medium-or-higher issue, and coverage added hosted-local proof that acceleration preserves the production instruction/tag contract.
- Accepted the deep-review finding that scheduled notification turns should not infer/mark onboarding complete without the full onboarding criteria prompt; simplified the automation so it archives only when onboarding is already marked completed and otherwise asks the next unresolved question.
- Reran focused assistant-runtime tests, `pnpm test:diff`, and `pnpm typecheck` successfully after the final instruction/test changes.
- Deep-review recheck found no remaining medium-or-higher issue.

Now:
- Close the active plan and create the scoped commit.

Next:
- Handoff to user.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/events.ts
- packages/assistant-runtime/test/hosted-runtime-events.test.ts
- apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts
- packages/assistant-runtime/README.md
- pnpm --dir packages/assistant-runtime test -- hosted-runtime-events.test.ts
- pnpm test:diff -- packages/assistant-runtime/src/hosted-runtime/events.ts packages/assistant-runtime/test/hosted-runtime-events.test.ts apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts packages/assistant-runtime/README.md
- pnpm typecheck
- agent-docs/exec-plans/active/2026-06-17-onboarding-daily-automation.md
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
