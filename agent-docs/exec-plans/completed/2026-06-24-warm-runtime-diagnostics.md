Goal (incl. success criteria):
- Extend PR #285 diagnostics so warm-runtime foreground delays can be attributed from existing latency phaseBreakdown/runtime logs.
- Success means active wake, foreground import, and runtime pass context are visible without adding a new queue, table, or durable owner.

Constraints/Assumptions:
- Keep diagnostics metadata-only and secret-safe.
- Keep conversation input highest priority over background/system work.
- Do not add synchronous observability writes to the reply hot path.
- Reuse the existing hosted runtime latency phaseBreakdown model.

Key decisions:
- Add only bounded numeric/boolean diagnostics to the existing wake phase.
- Prefer existing runtime pass and mailbox import seams over a new diagnostic subsystem.

State:
- Ready to archive after scoped commit.

Done:
- Read repo routing, hosted runtime, security, reliability, and verification guidance.
- Confirmed PR #285 already owns orchestration/cold-start diagnostics.
- Added wake-phase metadata for foreground wake ordinal, active runtime pass ordinal, active pass start, and whether the active pass began with foreground work.
- Updated hosted runtime control parsing/merge tests, workspace-runner wake timing tests, and web latency storage tests.
- Ran focused package tests/typecheck and `pnpm test:diff`.

Now:
- Finish the scoped commit and push PR #285.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- PR #285, branch `codex/temporal-wake-diagnostics`.
- Expected files: `packages/hosted-execution/src/runtime-control.ts`, `packages/assistant-runtime/src/hosted-runtime*.ts`, focused hosted runtime tests.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
