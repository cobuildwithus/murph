# Experiment Metric Directions

## Goal

Make experiment progress interpret expected movement per biomarker instead of applying one analysis-plan direction to every primary and secondary metric.

Success criteria:
- Experiment analysis plans can store per-biomarker expected directions.
- Query progress and outcome summaries use exact per-biomarker directions first.
- Legacy `desiredDirection` remains supported for the primary biomarker only.
- Secondary metrics without an explicit direction are shown as raw/contextual instead of inheriting the primary direction.
- Focused tests cover mixed primary and secondary directions.

## Constraints

- Preserve existing experiment records that only have `desiredDirection`.
- Keep the change scoped to contracts, query/progress, vault-usecases, CLI surface, and tests.
- Do not touch unrelated hosted/web dirty work in the checkout.
- No metric-name heuristics for favorable direction; store or derive the direction explicitly.

## Plan

1. Extend the experiment analysis-plan contract with an explicit biomarker direction map.
2. Add CLI/usecase support for repeated per-biomarker direction entries.
3. Update query/browser result builders to resolve directions by exact biomarker key, with legacy primary fallback only.
4. Add focused tests for mixed metric direction interpretation.
5. Run scoped verification, required audits, and create a scoped commit.

## Verification

Completed:
- Contract schema/example tests and artifact verification.
- Focused query/browser experiment result tests.
- Focused CLI experiment onboarding expansion tests.
- Root typecheck.
- Owner package coverage lanes for contracts, query, vault-usecases, and CLI.
- Smoke scenario integrity.
- Scoped diff whitespace check.

Known unrelated blocker:
- `scripts/workspace-verify.sh test:diff` reaches `packages/health-commons` reverse-dependent tests and fails because the generated biomarker browse index omits `sleep-quality` from unrelated dirty Health Commons content/state.

Commit note:
- `scripts/finish-task` could not be used safely because another active plan has overlapping unstaged changes in the same CLI/vault-usecases files. The final commit used a partial index for this plan's hunks only.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
