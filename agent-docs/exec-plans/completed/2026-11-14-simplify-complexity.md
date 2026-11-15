# Reduce repository complexity through deletion and simpler data flow

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Outcome and invariant

Reduce actual duplicated decisions and obsolete implementation across existing
package owners. Preserve accepted inputs, validation precedence, output shapes,
canonical state ownership, failure behavior and public package boundaries.
Use the existing classic cyclomatic metric, including debt above 20, without
changing its threshold or exclusions. No new service, dependency or state.

## Evidence and approach

Measure every tracked authored JS/TS source at the isolated checkout's base.
Inspect high-scoring functions and callers before choosing changes. Favor
removing repeated normalization and optional-shape traversal, constant mappings
in place of repeated alias branches, and proven unused implementation. Splitting
functions solely to reduce a score is excluded. Runtime coordination hotspots
need distinct authority/ordering proof; their size alone does not justify edits.

## Owners and scope

- Importers: provider normalization and CSV planning where exact behavior holds.
- Query: wearable summary projections and duplicated optional-data handling.
- CLI: repeated option conversion and address candidate assembly.
- Health metrics: duplicate pure normalization and caller-proven dead code.
- Core: food Markdown rendering repeats the same optional nutrient formatting.

All state and public boundaries remain with their existing owners. These are
internal refactors with no new product requirement or deployment protocol.

## Verification and completion

1. Establish exact-base complexity inventory and inspect candidate behavior.
2. Simplify independently owned source with focused behavioral coverage.
3. Run affected package tests and typechecks; inspect the complete diff.
4. Compare source lines, raw complexity, debt and maximum against exact base.
5. Record evidence and limitations, close plan and make scoped local commit.

No member-visible behavior change is intended; no changelog entry is needed.
No production mutation, PR, push or deployment is part of this local task.

## Completed changes

- CLI: derive state codes from the existing name map; resolve missing address
  containers once; simplify locality equality; merge numeric meal overrides.
- Core: format nutrients uniformly while preserving zero and absent values.
  Delete six unreferenced internal helpers, including the unreachable sample
  writer and unused validator wrapper. Declared package exports are unchanged.
- Importers: one sleep-stage alias map; one explicit duration grammar with
  separate set/session units, rounding and limits; remove redundant timestamp
  construction. Preserve CSV weight-validation error ordering.
- Health metrics: one calorie converter; remove an unreachable active-calorie
  energy-burned case and its redundant normalization/predicate helpers.
- Query: delete seven unused functions and their imports, including the unused
  selectMetric wrapper/runtime chain in this private workspace package. Resolve
  missing selection once and retain numeric-observation knowledge in its type;
  remove redundant weekday conversion. All tracked callers were checked.

## Measurement

Exact base: `ebf25597213a`. The initial survey of the primary checkout was a
separate revision; all comparisons here use the task checkout's exact base.
The existing analyzer covers 3,331 tracked authored JS/TS files and excludes
its existing test/generated categories. No metric thresholds or exclusions changed.

| Measure | Base | Candidate | Change |
| --- | ---: | ---: | ---: |
| Complexity debt above 20 | 9,725 | 9,639 | -86 |
| Summed cyclomatic complexity | 201,420 | 201,258 | -162 |
| Function count | 52,407 | 52,389 | -18 |
| Maximum function complexity | 182 | 182 | 0 |

Nineteen production source files changed: 152 added / 481 deleted lines,
net -329. Representative function scores: address candidate 56 to 34,
sleep-stage normalization 37 to 7, food rendering 32 to 19, wearable metric
summary 37 to 27, meal nutrition options 32 to 25.

## Verification results

- CLI: 46 focused address/meal tests; package typecheck passed.
- Core: 36 health-bank tests plus 27 tests across canonical-resource-lock,
  integration-ingest-cold-storage, core-event-thresholds, vault-family-registry
  and audit-boundary; final package typecheck passed.
- Health metrics: 6 catalog tests; package typecheck passed.
- Importers: 332 workout CSV/Junction tests; package typecheck passed;
  304 baseline/candidate duration comparisons matched.
- Query: 93 wearable, public JSON, metric, browser, projection, memory and weekly
  tests; final package typecheck passed; 810 weekly-stat comparisons matched.
- Total focused tests: 540 passed. Scenario-manifest coverage passed for
  191 scenarios, 12 sample inputs and 28 golden-output directories.
- Existing complexity regression guard, diff whitespace and added-line privacy
  checks passed. Parent reviewed every production diff and all deletion callers.

## Retained complexity and delivery boundary

The hosted runtime job remains the maximum at 182. The local stack startup
function's required strict-stop versus best-effort failure cleanup, dynamic
process ownership and optional diagnostics have distinct semantics. No safe
obsolete harness exports were found. Those paths remain intact; helper extraction
alone would only redistribute complexity. This pass introduces no lifecycle,
authority, schema, storage, retry, service or dependency changes.

This is a local candidate commit. No PR, hosted review, CI, deployment or
production verification was requested or performed. The existing CI and any
applicable external review remain delivery gates for a later PR.
Completed: 2026-11-14
