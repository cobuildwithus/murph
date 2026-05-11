# Murph Age input policy helper

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Make `packages/health-metrics` the single owner for Murph Age input-bundle metric/source eligibility so query does not carry a duplicate wearable-context metric list.

## Success criteria

- Query calls a health-metrics helper to decide whether a MetricPoint may enter Murph Age input-bundle assessment.
- Wearable metrics remain allowed only from wearable/activity/sleep summary sources.
- Lab/BP/body metrics remain allowed only from measurement or test-result sources.
- Existing scoring, context-only, public report, and product-mode behavior remain unchanged.

## Scope

- In scope: one small pure health-metrics helper, query call-site replacement, focused tests.
- Out of scope: changing bundle definitions, model policies, source kinds, score-bearing authorization, or model coefficients.

## Constraints

- Keep this as a direct cleanup, not a new policy framework.
- Preserve unrelated hosted/device-sync worktree edits.

## Risks and mitigations

1. Risk: source filtering broadens accidentally.
   Mitigation: keep existing query runtime tests and add focused helper assertions around wearable and lab source kinds.
2. Risk: future wearable metrics drift again.
   Mitigation: derive wearable eligibility from the existing health-metrics wearable-context feature definitions.

## Tasks

1. Add and export the health-metrics eligibility helper.
2. Replace query's local duplicate wearable metric set and predicate.
3. Run focused checks and required audits.
4. Close with a scoped commit.

## Verification

- `pnpm --dir packages/health-metrics typecheck` passed.
- `pnpm --dir packages/query typecheck` passed.
- `pnpm --dir packages/health-metrics test:coverage` passed with 33 tests.
- `pnpm --dir packages/query test:coverage` passed with 279 tests.
- `pnpm test:smoke` passed.
- `git diff --check -- agent-docs/exec-plans/active/2026-05-11-murph-age-input-policy-helper.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts packages/query/src/murph-age.ts packages/query/test/murph-age-runtime.test.ts` passed.
- Required coverage-write and security/privacy audit passes completed with no edits/findings.
- Final review found no findings.
- `pnpm typecheck` remains red in unrelated `scripts/verify.ts` / `@murphai/contracts` export drift outside this plan's touched files.
Completed: 2026-05-11
