Goal (incl. success criteria):
- Restore the repo to a green state for `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` on the current worktree.
- Success means the currently failing build/type boundaries are repaired with the smallest behavior-preserving edits and the required repo commands pass.

Constraints/Assumptions:
- Keep the fixes narrow and tied to observed verification failures.
- Preserve runtime behavior unless a failing test proves a contract mismatch.
- Respect overlapping core-domain and Linq lanes by preserving adjacent edits and only repairing the current compile/build/test blockers.

Key decisions:
- Fix the earliest root verification failures first so later errors are not masked.
- Prefer type/build contract repairs over broad refactors.
- Add only focused regression coverage when it materially locks down a repaired failure surface.

State:
- in_progress

Done:
- Read the current coordination ledger and the active green-checks/core-domain/Linq plans.
- Confirmed the current red surfaces from recent root verification output: `packages/core/src/bank/providers.ts`, `packages/cli/src/inbox-services/connectors.ts`, and `packages/cli/src/setup-wizard.ts`.
- Verified `packages/cli/tsconfig.typecheck.json` currently passes in isolation, so at least some of the remaining failures are root-build/package-boundary issues rather than a broken local source parse.

Now:
- Repair the core provider write-batch typing first, then rerun the root build to confirm the remaining CLI failures.

Next:
- Rerun `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`, fix any newly exposed blockers, then close out with completion audits and a scoped commit.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the current Linq and setup-wizard root-build failures disappear once the core build boundary is repaired, or whether they require small additional source/build-alignment fixes.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-25-green-checks-repair.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/core/src/bank/providers.ts`
- `packages/cli/src/inbox-services/connectors.ts`
- `packages/cli/src/setup-wizard.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
