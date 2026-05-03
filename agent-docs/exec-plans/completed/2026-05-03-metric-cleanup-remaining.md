Goal (incl. success criteria):
Land the remaining metric cleanup patch on current main. Success means metric goal comparisons normalize target units, canonical series aggregation avoids misleading unnormalized aggregates, query keeps unknown derived metric rows with custom metric definitions, metric-sample display-grade gating matches the cleanup policy, daily-aggregate goal selection policy is accepted by contracts and query parsing, and focused tests cover the landed behavior.

Constraints/Assumptions:
The supplied diff is partially stale because some metric-sample/browser-vault and daily-aggregate runtime pieces are already present.
Do not disturb unrelated dirty `apps/web/next-env.d.ts` local state.
This touches health data semantics and contract/query surfaces, so treat as high-risk package work with security/privacy, coverage-write, and task-finish audits.

Key decisions:
Port only the remaining behavior onto current source instead of blindly replaying stale hunks.
Keep the change scoped to `packages/contracts`, `packages/health-metrics`, and `packages/query` plus direct tests and plan/ledger files.

State:
in_progress

Done:
Reviewed repo workflow docs and confirmed the supplied patch does not apply cleanly to the current tree.
Ported the remaining production hunks and adapted focused health-metrics/query tests.
Generated contract JSON schema artifacts from `packages/contracts`.
Focused package tests and coverage passed for contracts, health-metrics, and query.
Root `pnpm typecheck` passed touched package typechecks, then failed on unrelated dirty `apps/web/app/design/components-content.tsx` `HeartbeatButton` props.
Security/privacy review found and fixed raw metric-sample display-qualifier promotion; targeted security re-review found no issues.
Coverage-write added focused tests for normalized between, daily aggregate policy, and raw metric-sample exclusion.
Task-finish reviews found and fixed current-value and rolling-window unsupported-unit comparison gaps.

Now:
Run final scoped finish checks and commit.

Next:
Archive this plan and create a scoped commit.

Open questions (UNCONFIRMED if needed):
None.

Working set (files/ids/commands):
packages/health-metrics/src/goals.ts
packages/health-metrics/src/series.ts
packages/health-metrics/test/index.test.ts
packages/contracts/src/zod.ts
packages/contracts/generated/frontmatter-goal.schema.json
packages/query/src/metrics/index.ts
packages/query/src/metrics/goals.ts
packages/query/src/browser-replica/build.ts
agent-docs/exec-plans/active/2026-05-03-metric-cleanup-remaining.md
agent-docs/exec-plans/active/COORDINATION_LEDGER.md
pnpm --dir packages/contracts generate
pnpm --dir packages/health-metrics test
pnpm --dir packages/contracts test
pnpm --dir packages/query test -- browser-vault-metric-points-labs-measurements.test.ts query.test.ts
pnpm --dir packages/health-metrics test:coverage
pnpm --dir packages/query test:coverage
pnpm --dir packages/contracts test:coverage
pnpm --dir packages/{contracts,health-metrics,query} typecheck
pnpm test:smoke
pnpm typecheck (blocked by unrelated apps/web HeartbeatButton onSuccess dirty state)
pnpm --dir packages/health-metrics test:coverage (rerun after audit fixes)
pnpm --dir packages/health-metrics typecheck (rerun after audit fixes)
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
