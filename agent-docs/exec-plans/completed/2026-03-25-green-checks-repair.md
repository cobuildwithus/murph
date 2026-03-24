Goal (incl. success criteria):
- Restore the repo to a green state for `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` on the current worktree.
- Success means the remaining verification drift is repaired with the smallest behavior-preserving edits and the required repo commands pass.

Constraints/Assumptions:
- Keep the fixes narrow and tied to observed verification failures.
- Preserve runtime behavior unless a failing test proves a contract mismatch.
- Respect overlapping in-flight lanes by preserving adjacent edits and only repairing the current verification blocker.

Key decisions:
- Re-run the required root commands before changing source so the repair matches the current worktree rather than stale failures.
- Keep the fix in the smoke-fixture layer because the remaining failure is a command-surface coverage audit, not a runtime defect.
- Add only the missing scenario manifests required to align the published command surface with the smoke verifier.

State:
- completed

Done:
- Read the current coordination ledger and the active green-checks/core-domain/Linq plans.
- Re-ran `pnpm typecheck` and confirmed the current worktree is green there without additional source edits.
- Re-ran `pnpm test`; the first pass exposed a stale-artifact failure in `packages/cli/test/health-tail.test.ts`, and the rebuilt workspace artifacts made the full root test pass on rerun.
- Re-ran `pnpm test:coverage` and narrowed the remaining failure to missing smoke scenarios for the documented `assistant cron preset list|show|install` commands.
- Added the missing smoke scenario manifests and verified them with `pnpm exec tsx e2e/smoke/verify-fixtures.ts --coverage`.
- Re-ran `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` successfully after updating the coordination metadata for the smoke-fixture change.

Now:
- None.

Next:
- Close the active lane and commit the scoped smoke-fixture repair.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-25-green-checks-repair.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `e2e/smoke/scenarios/assistant-cron-preset-list.json`
- `e2e/smoke/scenarios/assistant-cron-preset-show.json`
- `e2e/smoke/scenarios/assistant-cron-preset-install.json`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Status: completed
Updated: 2026-03-25
Completed: 2026-03-25
