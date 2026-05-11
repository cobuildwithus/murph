# Murph Age policy invariants

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Add mechanical tests that keep Murph Age card, bundle, query-filter, and wearable policy seams aligned while the model architecture evolves.

## Success criteria

- Score-bearing model-card metrics must stay reachable from their accepted input bundles.
- Query-side metric filters must match the health-metrics bundle metric lists.
- Wearable context and bridge metrics must remain non-score-bearing unless a future explicit model-card policy authorizes them.
- Existing scoring, public-report, and product-mode abstention behavior remain unchanged.

## Scope

- In scope: focused tests and tiny pure helper exports only if needed to inspect existing policy.
- Out of scope: model coefficient changes, product authorization changes, dataset adapters, source-rights work, or wearable score-bearing unlocks.

## Constraints

- Keep this local and mechanical. ReviewGPT already weighed in on the architecture direction; Codex should implement guardrails, not introduce a new model layer here.
- Preserve unrelated hosted/runtime worktree edits.

## Risks and mitigations

1. Risk: tests duplicate implementation details too tightly.
   Mitigation: assert high-level invariants across public helper outputs instead of snapshotting whole policy objects.
2. Risk: a test accidentally normalizes unsupported wearable score-bearing behavior.
   Mitigation: explicitly assert no current score-bearing card includes wearable context or bridge metrics.

## Tasks

1. Inspect existing health-metrics and query helper seams.
2. Add focused invariant tests.
3. Run package typechecks, coverage, smoke/diff checks, and required completion audits.
4. Close with a scoped commit.

## Verification

- `pnpm --dir packages/health-metrics typecheck` passed.
- `pnpm --dir packages/query typecheck` passed.
- `pnpm --dir packages/health-metrics test:coverage` passed with 33 tests.
- `pnpm --dir packages/query test:coverage` passed with 279 tests.
- `pnpm test:smoke` passed.
- `git diff --check -- agent-docs/exec-plans/active/2026-05-11-murph-age-policy-invariants.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md packages/health-metrics/test/index.test.ts packages/query/test/murph-age-runtime.test.ts` passed.
- Required coverage-write and security/privacy audit passes completed with no edits/findings.
- Final review found one low test-specificity gap; accepted-bundle-specific score-bearing metric coverage was added and the affected health-metrics checks were rerun.
- `pnpm typecheck` was attempted and failed in unrelated `scripts/verify.ts` / `@murphai/contracts` export drift outside this plan's touched files.
Completed: 2026-05-11
