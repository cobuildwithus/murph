# Final pass for test-smell cleanup and source-level test seam review

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Run one final package-scoped pass on the remaining clean test areas.
- Look specifically for source-level hacks that appear to exist only to make tests easier.
- Remove or simplify those hacks when they are unnecessary, and clean up any remaining duplicated test boilerplate around the same seams.

## Success criteria

- Five disjoint package/file clusters are reviewed by high-reasoning workers.
- If a source-level testing hack exists and is unnecessary, it is removed with tests updated accordingly.
- If no source change is justified, the worker either leaves the source alone or makes only narrow test cleanup changes.
- Focused verification passes for any touched packages.

## Scope

- In scope:
- selected clean files under `packages/{assistant-cli,device-syncd,importers,inboxd,setup-cli}/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-final-test-hacks-pass-5.md}`
- Out of scope:
- files already dirty from other active lanes
- broad package coverage work
- production refactors not tied to a concrete test seam or source-level test-only hack

## Current state

- A few remaining clean test files still use mocked-import seams or lazy imports.
- The user wants this final pass biased toward finding source code that may have been bent into awkward shapes just to support tests.
- Several adjacent package lanes are already active, so this pass must avoid shared dirty files and prefer clean source/test slices.

## Risks and mitigations

1. Risk:
   Touching source files that are already in flight elsewhere.
   Mitigation:
   Choose only clean source/test slices and keep worker ownership disjoint.
2. Risk:
   Removing a seam that is actually serving a real runtime boundary.
   Mitigation:
   Require workers to justify any source change as test-only or clearly unnecessary before editing.
3. Risk:
   Chasing cosmetic changes with no payoff.
   Mitigation:
   Bias toward concrete duplicated code or test-only branching, and accept no-op reviews where the source seam is legitimate.

## Tasks

1. Register the final pass in the coordination ledger.
2. Spawn five high-reasoning workers across clean, disjoint clusters.
3. Review landed diffs locally for any remaining source/test seam cleanup.
4. Run focused verification and a final audit pass.
5. Summarize outcomes and residual risk.

## Verification

- focused package-local tests and typechecks for touched files
- `pnpm typecheck` if it remains green
Completed: 2026-04-08
