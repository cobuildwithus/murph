# Junction body composition

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Preserve Junction body-composition summaries and sparse measurements as canonical, queryable vault facts without retaining full provider timeseries payloads.

## Success criteria

- Body summaries emit canonical bone-mass percentage, muscle-mass percentage, visceral-fat index, and body-water percentage observations.
- Sparse weight, body-fat, BMI, lean-body-mass, and waist-circumference readings emit one sample-grain observation per reading with exact canonical units, timestamp, stable identity, and compact evidence.
- Canonical health definitions and core history availability expose the new summary metrics.
- Focused importer, client/provider, core, and query tests prove mapping, replay identity, evidence minimization, and rejection of invalid readings.
- Documentation describes the supported body resources and retention boundary.

## Scope

- In scope: Junction request aliases and narrow resource registration required for focused tests; importer normalization; canonical metric definitions; core availability; query coverage; compatibility and architecture documentation.
- Out of scope: generic resource-catalog ownership, final history-window policy, dense raw timeseries storage, derived body-composition values, deployment, commits, pushes, PR creation, and ReviewGPT execution.

## Constraints

- Technical constraints: do not retain provider arrays or samples; use existing canonical core write and compact evidence paths; visceral fat remains an index, not a percentage; preserve stable external-reference identity across value corrections.
- Product/process constraints: edit only the isolated body-composition worktree, preserve unrelated files, use locked dependencies, apply focused verification, and leave review/commit/PR orchestration to the parent task.

## Risks and mitigations

1. Risk: temporary resource registration conflicts with the foundation catalog branch.
   Mitigation: limit registration edits to the minimum needed for this lane and keep normalization/provider-specific behavior locally owned.
2. Risk: body readings are accidentally aggregated or retained as raw arrays.
   Mitigation: normalize each reading directly into a sample-grain observation and assert compact evidence shape in tests.
3. Risk: upstream units or corrected values create duplicate facts.
   Mitigation: explicitly map canonical units and reuse the existing resource/source/timestamp identity helper without including the value.

## Tasks

1. Inspect existing body summary, sparse timeseries, identity, evidence, definitions, query, and tests.
2. Implement body-summary and sparse-reading canonical mappings.
3. Add canonical definitions, core/query availability, and focused tests.
4. Update compatibility and retention documentation.
5. Run focused tests, typechecks, privacy inspection, and review the complete diff.

## Decisions

- Keep long-history scheduling and catalog-wide drift policy out of this lane so the shared foundation branch can own them.
- Merge the foundation branch and make its contract policy table the sole resource-list owner. Admit weight, fat, BMI, lean mass, and waist as default sparse `canonical_per_record` resources with 180-day initial history and 30-day chunks.
- Apply the saved ReviewGPT findings after checking them against the installed Junction SDK 1.2.0 definitions: weight/fat use only `timestamp`; BMI/lean/waist use `start` and a strictly later `end`; deprecated or alias timestamps never supply identity; upstream units must match the documented literals exactly.

## Verification

- Commands to run: focused Vitest suites for Junction importer/provider, health metrics, core history, and query; relevant package typechecks; scoped formatting/lint checks where available.
- Expected outcomes: exact mappings and compact evidence pass with no new type errors, privacy leakage, or unrelated working-tree changes.
- Passed focused Vitest suites: contracts resource policy (5), device-sync provider/catalog (222), Junction importer (147), health metrics (53), core history (41), and browser-vault query (13).
- Passed package typechecks for contracts, device-syncd, importers, health-metrics, core, and query.
- Passed `git diff --check` and a scoped privacy scan. Prettier is not installed in this repository, so no formatter command was available.
Completed: 2026-08-11
