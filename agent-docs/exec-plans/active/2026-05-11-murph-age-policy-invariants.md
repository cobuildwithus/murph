# Murph Age policy invariants

Status: active
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

- Commands to run: focused health-metrics/query typechecks and coverage, root typecheck when unblocked, smoke, diff check, and required completion audits.
