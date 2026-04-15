# Get the remaining repo acceptance lane green by fixing the live repo blockers

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Clear the remaining live `pnpm test:coverage` blockers on the dirty tree.
- Keep each fix package-local, deterministic, and simpler than the current brittle seam.

## Success criteria

- `pnpm test:coverage` passes on the live tree, or any remaining failure is demonstrated to be unrelated to this lane.
- Any touched package keeps green package-local typecheck and coverage after the fix.
- Any touched tests are less timing-sensitive and avoid unnecessary harness complexity or duplication.

## Scope

- In scope:
- `packages/{operator-config,query,setup-cli}/{src/**,test/**,package.json,vitest*.ts}`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-09-remaining-repo-coverage-green.md}`
- Out of scope:
- unrelated package coverage or hosted-web work already in progress
- broad refactors outside the minimum seam needed to remove the acceptance blockers

## Current state

- The previous package-coverage integration task left `pnpm test:packages:coverage` and `pnpm typecheck` green at that point in time.
- The current live `pnpm test:coverage` run now fails earlier during prepared runtime artifacts because `packages/operator-config/src/knowledge-contracts.ts` re-exports from `@murphai/query`, which pulls `packages/query/src/**` into the operator-config project and breaks the package boundary/typecheck.
- `packages/query/src/knowledge-contracts.ts` is also currently dirty and contains schema/type errors around `DerivedKnowledgeSearchResult` and `z.ZodType` usage.
- The earlier `setup-cli` timeout in `packages/setup-cli/test/setup-assistant-wizard-flow.test.ts` may still remain after the knowledge-contract blocker is cleared, so this task keeps that seam in scope and verifies it directly.

## Risks and mitigations

1. Risk:
   The knowledge-contract break may overlap another in-flight query/data-model lane.
   Mitigation:
   Keep the fix narrow to the package boundary/type contract seam, read the current file state first, and avoid speculative ownership changes.
2. Risk:
   The wizard timeout may reflect a broader control-flow issue rather than just brittle test setup.
   Mitigation:
   Split investigation across source and test seams, then keep the landed change narrowly focused on the proven blocker.
3. Risk:
   Test cleanup may accidentally weaken behavior coverage while chasing determinism.
   Mitigation:
   Re-run focused package coverage and the full repo acceptance lane after changes.

## Tasks

1. Reconfirm the live `pnpm test:coverage` blocker set.
2. Split the knowledge-contract seam and the wizard seam across parallel investigation/fix lanes.
3. Land the minimum package-local source/test changes needed to remove the live blockers and simplify brittle tests honestly.
4. Re-run focused package verification for every touched package.
5. Re-run repo acceptance, then complete the required audit and commit flow.

## Verification

- Discovery:
  - `pnpm test:coverage`
- Focused:
  - `pnpm --dir packages/operator-config typecheck`
  - `pnpm --dir packages/query typecheck`
  - `pnpm --dir packages/setup-cli typecheck`
  - `pnpm --dir packages/setup-cli test:coverage`
- Final:
  - `pnpm typecheck`
  - `pnpm test:coverage`
Completed: 2026-04-09
