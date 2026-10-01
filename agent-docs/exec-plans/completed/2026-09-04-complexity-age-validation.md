# Collapse duplicate Murph Age card validation

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Delete duplicate card-validation bookkeeping while preserving accepted inputs,
  scientific and authorization boundaries, and exact warning/read order.

## Success criteria

- Shared aggregate checks retain explicit schema-owned key sets and subjects.
- The three target validators have lower complexity without a new validation framework.
- Focused tests, typecheck, and a base/head validation matrix pass.
- Parent candidate review, final ReviewGPT, and exact-head CI pass for an open PR.

## Scope

- In scope: aggregate warning helpers and frozen-boolean validation used by the
  increment, wearable-shadow, and activity-benchmark card validators; focused proof.
- Out of scope: scientific calculations, model parameters, schemas, field readers,
  source-route policy, product authorization, public APIs, and research.

## Constraints

- Preserve missing versus malformed optional fields, nullable metric rules,
  separate schema key sets, unknown-field ordering, and strict boolean checks.
- Use the existing warning accumulators and public validator entrypoints.
- No dependencies, persisted state, helper factory, schema engine, or new owner.

## Risks and mitigations

1. Consolidation could reorder warnings or weaken a scientific/export restriction.
   Mitigation: exact ordered-warning regressions, unchanged field reads, and an
   independent base/head matrix including malformed and multi-error candidates.

## Tasks

1. Inspect each duplicated block and its public tests.
2. Consolidate warning loops and remove duplicated finite-delta predicate.
3. Run package tests/typecheck, base/head comparison, and complexity checks.
4. Commit through finish-task, open draft PR, then run final review and CI after
   parent candidate clearance. Keep the new PR open.

## Decisions

- Parent approved this bounded validator-only scope at baseline
  `b6454467652310f7abdd63676dab0f769c340ae8`.
- Keep scientific semantics and error/read order explicit; no research is needed.
- Graft is unavailable, so inspection used exact baseline symbol ranges.

## Verification

- Focused health-metrics tests and package typecheck.
- Exact base/head public-validator result and property-read comparison matrix.
- Cyclomatic complexity diff, parent candidate review, final ReviewGPT, and CI.

## Results

- Shared aggregate warning loops retain separate schema key sets; duplicate
  finite-delta predicate deleted. Four frozen-boolean loops now share one helper.
- The existing aggregate-receipt model-metric caller uses the same consolidated
  unknown-field/numeric check with its original label and ordering.
- Package tests: 10 files, 80 tests passed. Package typecheck passed.
- Independent source-bundled baseline/head comparison: 5,477 cases matched exact
  validator results and Proxy get/ownKeys/descriptor traces (shadow 641,
  increment 1,068, benchmark 1,959, receipt 1,809). Cases include omitted,
  malformed, nonfinite, nullable, unknown-field, and simultaneous errors.
- Ordered warning regressions cover numeric/schema errors, nullable AUC/c-index,
  and strict frozen booleans across all four benchmark policy sections.
- Complexity guard passed: file debt 158 to 136; increment validator 51 to 45,
  benchmark validator 40 to 28, shadow validator 39 to 35. Other listed hotspots
  retain distinct scientific/calculation/parameter-validation decisions outside
  this duplicate-loop scope; no further generic validation framework is justified.
- Frog inventory inspected; no new repository friction required a workaround.
- Parent candidate review and exact-head ReviewGPT/CI remain PR completion gates.
Completed: 2026-09-04
