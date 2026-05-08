Goal (incl. success criteria):
- Keep hosted foreground assistant responses from waiting on mailbox post-checkpoint enrichment effects.
- Regression proves a never-resolving mailbox effect does not block the assistant from reaching `input.reply-started`.

Constraints/Assumptions:
- Preserve imported assistant input as the prompt-critical path; inbox projection/enrichment is best effort.
- Do not broaden workspace checkpointing or add new persisted state.
- Preserve unrelated dirty worktree edits and active ledger rows.

Key decisions:
- Assistant-bearing foreground runs schedule mailbox post-checkpoint effects as background enrichment.
- No-assistant/import-only paths keep awaited effect logging because there is no reply-first user path.

State:
- Completed. Committed with an explicit scoped patch because the same runner files still contain unrelated active edits.

Done:
- Read workflow, hosted runtime protocol, verification, security, and reliability docs.
- Located foreground await sites in `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`.
- Assistant-bearing foreground runs now schedule mailbox post-checkpoint effects without awaiting them before assistant work or return.
- Added regressions for never-resolving assistant-bearing enrichment, background ordering/logging, and no-assistant awaited/logged effects.
- Focused runner Vitest passed.
- Security/privacy and final completion reviews found no issues.

Now:
- Handoff.

Next:
- Resolve unrelated dirty worktree blockers before broader verification can go green.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `agent-docs/exec-plans/completed/2026-05-09-hosted-mailbox-effects-background.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
