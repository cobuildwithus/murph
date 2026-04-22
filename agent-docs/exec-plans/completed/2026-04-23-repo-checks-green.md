# Get repo checks green

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Restore green repo checks for the current dirty worktree by fixing the failing research scaffold lane and any additional red checks surfaced by the current CLI-related diff.

## Success criteria

- `pnpm typecheck` passes.
- `pnpm test:diff packages/cli/src/commands/entity-command-groups.ts scripts/research-orchestrator/lib.mjs scripts/research-init.mjs scripts/research-materialize.mjs scripts/research-init.test.ts` passes.
- If scoped fixes broaden or `test:diff` is insufficiently truthful, rerun the smallest truthful higher-level verification until the touched lanes are green.
- Required completion audits (`coverage-write` if the final verification lane is coverage-bearing, then `task-finish-review`) are complete.

## Scope

- In scope:
- `scripts/research-orchestrator/lib.mjs`
- `scripts/research-init.test.ts`
- `packages/cli/src/commands/entity-command-groups.ts`
- Directly coupled CLI tests or repo-tool tests needed to restore green checks
- Out of scope:
- Unrelated product or architecture changes outside the failing verification lanes

## Constraints

- Technical constraints:
- Preserve unrelated working-tree edits and other active ledger rows.
- Keep fixes narrow to failing checks; do not widen into unrelated research or CLI redesign.
- Product/process constraints:
- Follow the repo completion workflow, including required audit passes before handoff.
- Use subagents on the concrete failing areas.

## Risks and mitigations

1. Risk: More than one failing lane is hidden behind the first `test:diff` failure.
   Mitigation: Fix the first blocker, rerun scoped verification, and fan out remaining red areas to dedicated workers.
2. Risk: Existing overlapping changes in the CLI or research tooling could conflict with a narrow fix.
   Mitigation: Keep ownership scoped, inspect diffs carefully, and avoid reverting unrelated edits.

## Tasks

1. Capture the current failing verification output for the dirty worktree. Done.
2. Fix the repo-tools research scaffold failure. Done.
3. Surface and fix any remaining CLI-lane failures from the current diff. Done; the CLI lane was already green and needed no edit.
4. Run required verification and completion audits. Done.
5. Commit the scoped fix set with the closed execution plan. Next.

## Decisions

- Use the current dirty worktree as the source of truth and target the minimal truthful verification lane first (`pnpm test:diff ...`) instead of guessing from older ledger notes.
- Include the research scaffold support-file wiring in the fix because the final audit found the previous green test only proved a string change, not the workspace package-script behavior.
- Preserve the existing `packages/cli/src/commands/entity-command-groups.ts` dirty edit as an inspected/verified lane; do not widen the research fix into CLI implementation work.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/research-init.test.ts`
- `node --check scripts/research-orchestrator/lib.mjs`
- `node --check scripts/research-init.mjs`
- `node --check scripts/research-materialize.mjs`
- `git diff --check`
- `pnpm test:diff packages/cli/src/commands/entity-command-groups.ts scripts/research-orchestrator/lib.mjs scripts/research-init.mjs scripts/research-materialize.mjs scripts/research-init.test.ts`
- Additional focused test commands only if needed to iterate on a specific failing area
- Expected outcomes:
- The scoped dirty-tree diff verifies green without introducing unrelated failures.

Final outcomes:
- `pnpm typecheck`: passed.
- Focused `scripts/research-init.test.ts`: passed, 5 tests.
- Node syntax checks for the research scripts: passed.
- `git diff --check`: passed.
- Scoped `pnpm test:diff ...`: passed; repo-tools tests passed (16 files, 90 tests), `packages/cli` typecheck passed, and `packages/cli` source tests passed (76 files, 762 tests).
- Required `coverage-write`: no additional proof changes needed.
- Required `task-finish-review`: found a medium research scaffold support-file gap; fixed by emitting/backfilling the workspace review-gpt config and package-context script, then reran the affected checks green.
Completed: 2026-04-23
