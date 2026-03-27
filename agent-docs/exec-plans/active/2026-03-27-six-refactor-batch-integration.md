# Six refactor batch integration

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Review the completed six-worker refactor batch as one combined change set.
- Cut back or fix any cross-lane regressions.
- Run focused verification plus the required completion-workflow audit passes.
- Commit the integrated result if the remaining failures are credibly unrelated.

## Scope

- In scope:
  - worker outputs from `.codex-runs/20260327-195602`
  - small compatibility fixes required to make the six lanes coexist
  - focused tests and typechecks for the changed slices
  - required `simplify`, `test-coverage-audit`, and `task-finish-review` subagent passes
- Out of scope:
  - widening any lane beyond its original behavior-preserving brief
  - fixing unrelated pre-existing dirty-tree failures outside the changed slices unless they directly block truthful verification of this batch

## Constraints

- Keep the refactors behavior-preserving.
- Do not revert unrelated dirty work.
- Treat worker claims as provisional until verified against the combined worktree state.
- Preserve the current orchestration artifacts and use them as review context, not as user-facing product changes.

## Review checklist

1. Confirm the worker outputs do not leave stale ledger rows or broken orchestration artifacts.
2. Inspect each lane for overreach, especially:
   - hosted onboarding receipt extraction
   - canonical write-guard/core parsing split
   - hosted runtime lifecycle staging
3. Re-run focused verification after all integration fixes, not just per-lane worker checks.
4. Run required audit passes and address any material findings.
5. Commit only the exact integrated files for this batch.

## Outcome

- Integrated the six worker lanes from `.codex-runs/20260327-195602` without widening scope.
- Applied one audit-driven cleanup: removed the stale `recoverStoredWriteOperationForGuard()` passthrough after the core recovery helper landed.
- Focused verification passed across the touched `apps/web`, `packages/query`, `packages/core`, `packages/cli`, `packages/assistant-runtime`, and `apps/cloudflare` slices.
- Required audit passes completed:
  - `simplify`: one valid low-risk cleanup, applied
  - `test-coverage-audit`: no actionable missing-test gaps
  - `task-finish-review`: no actionable findings
- Root `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` still fail only on the unrelated dirty-tree `apps/cloudflare/src/user-runner/runner-bundle-sync.ts` TS2554 errors.
