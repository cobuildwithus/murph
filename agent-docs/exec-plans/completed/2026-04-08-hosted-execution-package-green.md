# Get `packages/hosted-execution` green and above package-local coverage thresholds

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Make `packages/hosted-execution` pass its package-local verification and coverage gates.
- Keep the fix isolated to `packages/hosted-execution/**` plus the required workflow metadata.

## Success criteria

- `pnpm --dir packages/hosted-execution typecheck` passes.
- `pnpm --dir packages/hosted-execution test` passes.
- `pnpm --dir packages/hosted-execution test:coverage` passes.
- Any added or changed tests are deterministic and raise honest coverage on the current `src/**/*.ts` surface rather than weakening thresholds.

## Scope

- In scope:
- `packages/hosted-execution/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-hosted-execution-package-green.md}`
- Out of scope:
- root or shared coverage-threshold changes unless an honest package-local fix proves impossible without them
- unrelated package or app coverage work already active elsewhere in the tree

## Current state

- `packages/hosted-execution test:coverage` currently fails on `src/{builders,dispatch-ref,hosted-email,observability,outbox-payload,parsers,side-effects}.ts`.
- Existing package-local tests pass, but only 22 tests currently run and large seams are still unexercised.
- The repo worktree is already dirty with multiple active coverage and hosted-web lanes, so this lane must preserve unrelated edits and stay narrow.

## Risks and mitigations

1. Risk:
   Coverage gaps may tempt broad runtime edits when focused tests would be enough.
   Mitigation:
   Prefer deterministic tests first and change source only if a path is genuinely untestable or incorrect.
2. Risk:
   Overlap with the existing broad package-coverage cleanup lane causes conflicts.
   Mitigation:
   Keep ownership limited to `packages/hosted-execution/**` and the two workflow files for this lane.
3. Risk:
   Some package-local behavior may currently depend on adjacent dirty workspace changes.
   Mitigation:
   Re-baseline with package-local commands first and document any upstream blockers with concrete evidence.

## Tasks

1. Register the hosted-execution lane and inspect the current package-local failures.
2. Split the uncovered seams across parallel worker lanes with disjoint file ownership.
3. Integrate focused test additions and any minimal source fixes required to exercise the real behavior.
4. Re-run package-local verification and coverage.
5. Run the required final audit review, resolve findings, and finish with a scoped commit.

## Verification

- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/hosted-execution test`
- `pnpm --dir packages/hosted-execution test:coverage`
Completed: 2026-04-08
