# Close the remaining repo acceptance blocker in assistant-runtime callback coverage

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Clear the remaining repo acceptance failures on the live tree.
- Keep the landed fixes narrow: a package-reference correction for `operator-config` and focused callback-coverage proof in `assistant-runtime`.

## Success criteria

- `pnpm test:coverage` passes on the live tree after the focused fixes.
- `pnpm typecheck` passes on the live tree after the focused fixes.
- Any touched assistant-runtime tests stay deterministic and simpler than the current gap-driven coverage chase.

## Scope

- In scope:
- `packages/assistant-runtime/{src/**,test/**,package.json,vitest*.ts}`
- `packages/operator-config/{tsconfig.json,tsconfig.typecheck.json}`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-09-assistant-runtime-callback-coverage-green.md}`
- Out of scope:
- broader hosted-runtime refactors outside the minimum seam needed to cover the missing callback branches

## Current state

- The first live blocker in this turn was `packages/operator-config`, where a new type-only re-export from `@murphai/query` pulled `query/src/**` into the operator-config project; adding `../query` project references to both operator-config tsconfigs cleared that blocker on the live tree without widening the package surface.
- The next live blocker was generated sidecar residue under `packages/query/src/knowledge-contracts.{d.ts,js}`, which was removed after the hygiene guard flagged it.
- The final live blocker was `packages/assistant-runtime/src/hosted-runtime/callbacks.ts` at `79.36%` branch coverage against an `80%` threshold.
- Focused callback tests now cover the missing hosted side-effect journal failure branches and the local-delivery-without-idempotency fallback path.
- The live tree now passes both `pnpm test:coverage` and `pnpm typecheck`.

## Risks and mitigations

1. Risk:
   The missing branch may be in a sensitive hosted callback path where source changes could disturb behavior.
   Mitigation:
   Inspect the exact uncovered branches first and prefer narrow test-only proof unless the source itself is demonstrably wrong.
2. Risk:
   Coverage-driven tests can become overfit or duplicate neighboring hosted-runtime cases.
   Mitigation:
   Reuse existing hosted-runtime helpers and cover the missing branches with one or two direct high-signal scenarios.

## Tasks

1. Clear the first live acceptance blocker without widening package boundaries unnecessarily.
2. Inspect the uncovered `callbacks.ts` branches and current hosted-runtime callback tests.
3. Use a parallel worker plus local integration to add the minimum proof needed.
4. Re-run repo acceptance and typecheck, then complete the required audit and commit flow.

## Verification

- Focused:
  - `pnpm --dir packages/operator-config typecheck`
  - `pnpm --dir packages/setup-cli typecheck`
  - `pnpm --dir packages/setup-cli test:coverage`
- Final:
  - `pnpm typecheck`
  - `pnpm test:coverage`
Completed: 2026-04-09
