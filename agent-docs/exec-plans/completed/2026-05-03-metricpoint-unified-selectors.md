# Land shared metric projection and selectors patch

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Land the supplied shared metric projection/selector patch on the current checkout.
- Query projections and browser-vault metric views should derive `MetricPoint` values through one shared projection path, and baseline/intervention trend math should use shared `@murphai/health-metrics` selectors.
- Land the supplied metric architecture follow-up that splits the health-metrics package, version-bumps metric schemas, adds requested metric selection rows, and centralizes goal metric target parsing.

## Success criteria

- Patch intent is ported without overwriting unrelated dirty work.
- Health metric selector tests cover window comparison and trend behavior.
- Browser-vault metric selections emit requested no-data/stale/unsupported-capable rows while metric rows remain lookback bounded.
- Unknown lab analytes flow into custom metric points.
- Goal metric target parsing supports `startAt` and `selectionPolicyOverride` in both query projection and browser-vault goal progress.
- Query/browser-vault tests continue to pass for the touched projection surfaces.
- Required repo verification and completion review passes are complete or any unrelated blockers are documented.

## Scope

- In scope:
- `packages/health-metrics` shared window/trend selectors and tests.
- `packages/health-metrics` package split, metric schema version constants, catalog normalization, selectors, series, goal progress, and formatting.
- `packages/query` metric projection builder, query projection wiring, goal-target parser, browser-vault metric rows/selections, and directly coupled tests.
- `packages/contracts` goal metric target Zod schema for `selectionPolicyOverride`.
- Out of scope:
- Provider ingestion changes, UI redesign, and unrelated hosted web/content work already dirty in the checkout.

## Constraints

- Technical constraints:
- Query code stays read-only relative to canonical vault evidence.
- Metric projection remains derived from canonical vault evidence plus sample and wearable summaries.
- Browser-vault schema version bumps must stay explicit and parser-enforced.
- Existing goal-progress status semantics from the in-flight identity/status patch must be preserved while applying the follow-up.
- This metric architecture slice is greenfield: do not preserve legacy `body_measurement` or `observation` compatibility extraction into MetricPoint.
- Package boundaries should use declared owner entrypoints.
- Product/process constraints:
- Do not expose local filesystem identifiers or sensitive health payloads in code, docs, tests, logs, or commits.
- Preserve unrelated dirty-tree edits and active work notices.

## Risks and mitigations

1. Risk: The supplied patch is stale against the current browser-vault files.
   Mitigation: Port hunks manually against the current file shapes and verify with package tests.
2. Risk: Shared selector behavior changes experiment trend/baseline semantics.
   Mitigation: Keep the selectors pure, test the edge cases directly, and run focused query tests.

## Tasks

1. Register the active ledger row.
2. Inspect the current files and patch intent.
3. Port the shared metric projection and selector changes.
4. Apply and reconcile the metric architecture follow-up script.
5. Run focused package tests, typecheck, and smoke checks required by the workflow.
6. Run mandatory completion review passes and address findings.
7. Close the plan through the scoped commit path.

## Decisions

- Use a plan-bearing path because the patch is multi-file and needs manual porting after stale hunks.
- Treat the downloaded script as patch intent, not overwrite authority; reconcile it with the existing in-flight metric identity and goal-progress status changes.
- User clarified this is greenfield; hard-cut metric-specific compat extraction instead of preserving old row/provenance shapes.

## Verification

- Commands to run:
- `pnpm --filter @murphai/health-metrics test`
- `pnpm --filter @murphai/health-metrics typecheck`
- `pnpm --filter @murphai/query test`
- `pnpm --filter @murphai/contracts test`
- `pnpm typecheck`
- `pnpm test:smoke`
- Expected outcomes: all required checks pass, or unrelated pre-existing blockers are documented with focused proof for this change.
Completed: 2026-05-03
