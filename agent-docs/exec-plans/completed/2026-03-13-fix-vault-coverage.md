Goal (incl. success criteria):
- Make `pnpm test:coverage` pass by addressing the current branch coverage shortfall for `packages/core/src/vault.ts`.
- Prefer targeted tests over runtime changes unless investigation finds an actual defect.

Constraints/Assumptions:
- Work on top of the current tree without reverting unrelated edits.
- Keep scope to `packages/core/src/vault.ts` and the narrowest relevant core tests.
- Do not touch files claimed by other active ledger rows.

Key decisions:
- Start from the current uncovered branches in `packages/core/src/vault.ts`.
- Add the smallest truthful tests that exercise the uncovered vault branches if behavior is already correct.

State:
- in_progress

Done:
- Re-ran `pnpm test` and `pnpm test:coverage`.
- Confirmed `pnpm test` passes and `pnpm test:coverage` currently fails only on `packages/core/src/vault.ts` branch coverage.

Now:
- Inspect `packages/core/src/vault.ts` uncovered branches and nearby tests.
- Add the narrowest missing coverage needed to satisfy the threshold.

Next:
- Re-run targeted tests, then `pnpm test:coverage`, then close the active plans and commit the scoped files.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether the remaining uncovered branches can be exercised entirely through existing public APIs without broad fixture setup.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-fix-vault-coverage.md`
- `packages/core/src/vault.ts`
- `packages/core/test/**/*.test.ts`
- Commands: `pnpm test`, `pnpm test:coverage`, targeted `vitest` runs as needed
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
