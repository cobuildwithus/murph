# Final package-wide cleanup pass for `packages/operator-config`

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Review `packages/operator-config/**` broadly for source-level hacks or extra seams that appear to exist mainly to make tests easier.
- Remove or simplify those seams only when they are clearly unnecessary.
- Clean up any remaining duplicated mocked-import or helper patterns in package tests when there is a clear payoff.

## Success criteria

- Five GPT-5.4 medium-reasoning workers inspect the package by subsystem with minimal overlap.
- Any source-level testing seam removed has a clear non-test simplification payoff.
- Remaining mocked-import cleanup stays package-local and avoids unrelated repo files.
- Focused `packages/operator-config` verification passes for the touched scope.

## Scope

- In scope:
- `packages/operator-config/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-operator-config-final-cleanup.md}`
- Out of scope:
- other packages
- broad architecture or package-boundary changes unrelated to testing seams
- speculative refactors with no concrete test-cleanup payoff

## Risks and mitigations

1. Risk:
   Removing a seam that exists for a real runtime reason rather than tests.
   Mitigation:
   Require concrete proof that the seam is test-motivated and unnecessary before changing source.
2. Risk:
   Five workers in one package collide on the same files.
   Mitigation:
   Split prompts by subsystem and keep ownership disjoint.
3. Risk:
   Cleanup churn outweighs value.
   Mitigation:
   Prefer small local helpers or direct imports over larger abstractions.

## Tasks

1. Audit the package shape and likely source/test seams locally.
2. Spawn five package-wide subsystem workers on GPT-5.4 with medium reasoning.
3. Integrate only clearly justified cleanup changes.
4. Run focused operator-config tests and typecheck.
5. Run the required final review pass and hand off exact files changed plus source-level findings.

## Verification

- `pnpm --dir packages/operator-config test -- <focused tests>`
- `pnpm --dir packages/operator-config typecheck`
Completed: 2026-04-08
