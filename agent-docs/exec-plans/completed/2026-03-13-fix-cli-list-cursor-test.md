Goal (incl. success criteria):
- Make `pnpm test` and `pnpm test:coverage` pass again by fixing the current `packages/cli/test/list-cursor-compat.test.ts` failure.
- Keep the change limited to the cursor-removal CLI surface and preserve the intended “no cursor option” behavior.

Constraints/Assumptions:
- Do not edit files claimed by other active ledger rows.
- Work on top of the current tree; do not revert unrelated ongoing changes.
- Treat the failing test as the entry point, then patch the narrowest CLI runtime/schema files needed.

Key decisions:
- Start from the failing test output and inspect actual CLI help/schema behavior before changing code.
- Prefer behavior-preserving alignment between runtime output and the updated no-cursor contract.

State:
- in_progress

Done:
- Re-ran `pnpm test` and `pnpm test:coverage`.
- Isolated the active failure to `packages/cli/test/list-cursor-compat.test.ts`.
- Claimed the cursor-removal CLI files in the coordination ledger.

Now:
- Inspect the failing test and the associated CLI schema/command files.
- Patch the smallest mismatch causing the cursor-removal assertion to fail.

Next:
- Re-run targeted tests, then repo-required checks, then completion-workflow audits and commit the scoped files.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether the current failure is a stale test expectation or an actual runtime/schema cursor regression.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-fix-cli-list-cursor-test.md`
- `packages/cli/src/vault-cli-contracts.ts`
- `packages/cli/src/commands/health-command-factory.ts`
- `packages/cli/src/commands/read.ts`
- `packages/cli/src/commands/intake.ts`
- `packages/cli/src/vault-cli-services.ts`
- `packages/cli/test/list-cursor-compat.test.ts`
- Commands: `pnpm test`, `pnpm test:coverage`
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
