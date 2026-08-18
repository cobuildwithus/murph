# junction-timeseries-default-convergence

Status: active
Created: 2026-08-18
Updated: 2026-08-18

## Goal

- Restore the curated Junction timeseries default for hosted runtime configs
  that intentionally omit the code-owned resource list, so long device-sync
  continuations remain bounded and converge.

## Success criteria

- An omitted Junction timeseries list normalizes to the curated default set and
  excludes resources whose contracts policy marks as explicit opt-ins.
- Explicit resource lists, including the code-owned production list, remain
  unchanged.
- Focused tests prove both behaviors, and required ReviewGPT and CI gates pass.

## Scope

- In scope: Junction runtime-config normalization and focused tests.
- Out of scope: resource-policy changes, scheduler recovery semantics, schema
  changes, and unrelated iOS checks.

## Constraints

- Preserve every explicit Junction resource selection exactly after canonical
  normalization.
- Keep resource ownership in the contracts package; do not duplicate lists.
- Do not weaken consent, billing/access, connection-epoch, or health-data gates.

## Tasks

1. Prove the live non-convergence and trace the hosted runtime configuration.
2. Have ReviewGPT independently audit the evidence and exact code path.
3. Add a focused failing regression and implement the smallest correction.
4. Run focused tests/typechecks, required review gates, and exact-head CI.
5. Merge/deploy and confirm the affected connection advances its durable
   completion and reconcile frontiers.

## Decisions

- Treat repeated due-reconcile signals as secondary recovery churn, not the
  root cause: retained continuations already suppress duplicate provider roots.
- Change only the omitted-list fallback. Explicit all-resource configuration
  remains available and unchanged.

## Verification

- Focused device-sync configuration and provider-manifest tests.
- Relevant package typecheck and diff checks.
- Required ReviewGPT/CI gates on the pushed PR head.
- Redacted production aggregate showing durable completion and reconcile
  frontiers advance after deployment.
