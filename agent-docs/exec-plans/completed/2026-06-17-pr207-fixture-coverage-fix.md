Goal (incl. success criteria):
- Unblock PR 207 merge by restoring smoke scenario coverage for documented workout import-json and payload-schema commands after the branch update from main.

Constraints/Assumptions:
- Keep change limited to scenario manifests and active-plan bookkeeping.
- Do not alter logging invariant implementation.

Key decisions:
- Add scenario manifests matching the documented command strings exactly.

State:
- Ready to close.

Done:
- Identified failing CI root cause in Release fixture coverage.
- Added missing workout import-json and payload-schema scenario manifests.
- Verified scenario coverage and root smoke integrity.
- Refreshed ignored vault-usecases build output and reran typecheck successfully.

Now:
- Commit the scoped fix with finish-task.

Next:
- Push, wait checks, merge PR.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- e2e/smoke/scenarios/workout-import-json.json
- e2e/smoke/scenarios/workout-payload-schema.json
- agent-docs/exec-plans/active/2026-06-17-pr207-fixture-coverage-fix.md
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
- pnpm exec tsx e2e/smoke/verify-scenario-integrity.ts --coverage
- pnpm test:smoke
- pnpm --dir packages/vault-usecases build
- pnpm typecheck
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
