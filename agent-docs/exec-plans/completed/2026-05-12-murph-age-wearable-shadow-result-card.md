# Murph Age Wearable Shadow Result Card

## Goal

Add the smallest research-only policy seam that lets Murph Age record aggregate wearable/activity/sleep shadow-increment evaluator results over a frozen score-bearing anchor without authorizing wearable score contribution, product display, row export, participant-level export, prediction export, or coefficient export.

## Scope

- `packages/health-metrics/src/murph-age.ts`
- `packages/health-metrics/test/index.test.ts`

## Constraints

- Runtime wearable readiness summaries remain `riskEffect: "not-estimated"`.
- Aggregate benchmark result cards may mark a wearable shadow increment as `riskEffect: "aggregate-estimated"` only inside a blocked research artifact contract.
- No row values, participant identifiers, split membership, predictions, coefficients, source bodies, product claims, recommendation claims, or protocol claims.
- Preserve R399, Lab9, and Lab5 as score-bearing anchors; wearable increments remain non-score-bearing.
- Preserve unrelated hosted-runner and final-fixes worktree edits.

## Verification Plan

- `pnpm --dir packages/health-metrics test -- index`
- `pnpm --dir packages/health-metrics typecheck`
- `pnpm test:diff packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts`
- `pnpm logs:guard`
- `git diff --check -- packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts agent-docs/exec-plans/active/2026-05-12-murph-age-wearable-shadow-result-card.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## State

- Done: added the strict research-only result-card validator and focused tests.
- Done: security/privacy review found an unknown-field leakage gap; fixed with strict shape checks at every object layer.
- Done: final review found malformed nested-object and malformed aggregate-value gaps; fixed with unknown-boundary parsing and finite/nonnegative aggregate checks.
- Done: coverage-write added compatible-anchor proof for Lab9 and Lab5.
- Done: simplify feedback was applied by deriving evidence tiers from one tuple and simplifying the result-card interface.

## Verification Results

- `pnpm --dir packages/health-metrics test -- index` passed.
- `pnpm --dir packages/health-metrics typecheck` passed.
- `pnpm --dir packages/health-metrics test:coverage` passed.
- `pnpm test:smoke` passed.
- `pnpm logs:guard` passed.
- `git diff --check -- packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts agent-docs/exec-plans/active/2026-05-12-murph-age-wearable-shadow-result-card.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm test:diff packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts` is blocked by unrelated `packages/assistant-runtime` hosted-liveness type errors before the health-metrics lane completes.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
