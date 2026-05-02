# Land final production metric architecture patch

Status: completed
Created: 2026-05-02
Updated: 2026-05-03

## Goal

- Land the supplied final production metric architecture patch on the current tree.
- Browser-vault should expose final metric-key rows/selections/series/goal progress without legacy domain/day row surfaces.
- Health metrics should remain the neutral metric identity/selection owner, while query owns the derived read-model projection and target/progress helpers.

## Success criteria

- Supplied patch is applied or faithfully ported where stale.
- TypeScript and focused query/health-metrics tests pass, or any blocker is shown to be unrelated to this diff.
- Required security/privacy, coverage, and finish reviews are completed.
- A scoped commit lands only the plan, ledger closeout, and files touched for this metric architecture patch.

## Scope

- In scope:
  - `packages/health-metrics/**`
  - `packages/query/src/metrics/**`
  - `packages/query/src/browser-replica/**`
  - `packages/query/src/browser*.ts`
  - directly coupled query tests
  - directly coupled biomarker trend path if the patch applies cleanly
- Out of scope:
  - unrelated hosted onboarding, hosted-local, Health Commons content, device-sync, or assistant-runtime work already dirty in this checkout
  - broader UI redesign beyond the supplied biomarker trend dependency cut

## Constraints

- Technical constraints:
  - Preserve canonical vault evidence as source of truth; query/browser-vault outputs remain rebuildable read models.
  - Do not reintroduce browser-domain metric bindings or v1/v2/v3 browser-vault table suffixes.
  - Avoid unsafe TypeScript casts to paper over integration issues.
- Product/process constraints:
  - Preserve unrelated dirty working-tree edits.
  - Follow high-risk schema/storage workflow: plan, ledger, required audits, verification, and scoped commit.
  - Do not expose local usernames, home paths, secrets, or direct personal identifiers in files or handoff.

## Risks and mitigations

1. Risk: The patch script overwrites whole files and may be stale against current source.
   Mitigation: Inspect diff after apply and manually repair only the intended metric architecture surface.
2. Risk: Browser-vault schema changes can break downstream exports and tests.
   Mitigation: Run the requested focused tests plus root typecheck and complete required reviews.
3. Risk: Query persisted-state migration shape can drift from repo state rules.
   Mitigation: Verify explicit `query_metric_targets` schema creation/reset/version checks and keep it as rebuildable query projection state.

## Tasks

1. Apply the supplied patch script from repo root.
2. Inspect and repair the resulting diff.
3. Run requested focused checks and root typecheck.
4. Run required security/privacy, coverage-write, and task-finish audit passes.
5. Close the plan and create a scoped commit.

## Decisions

- Treat this as a high-risk supplied patch landing because it changes health-data projection schema and exported browser-vault contracts.
- Skip a simplify audit because the change arrives as a bounded external patch rather than local exploratory implementation.

## Verification

- Passed:
  - `pnpm --filter @murphai/health-metrics typecheck`
  - `pnpm --filter @murphai/contracts typecheck`
  - `pnpm --filter @murphai/query typecheck`
  - `pnpm --filter @murphai/query test metric-points`
  - `pnpm --filter @murphai/query test browser-vault`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `git diff --check -- packages/query/src/metrics/index.ts`

## Completion notes

- Bulk patch landed in `21dae046b`.
- Follow-up local fix adds the required `grain: "day"` field to glucose sample-summary `MetricPoint` extraction.
- Unrelated hosted-onboarding files remain dirty and are not part of this plan closeout.
Completed: 2026-05-03
