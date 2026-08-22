# junction-timeseries-default-convergence

Status: completed
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
- A durable pre-deploy continuation whose cursor names a now-opt-in resource
  restarts its same owner window on the curated defaults and terminates.
- Focused tests prove both behaviors, and required ReviewGPT and CI gates pass.

## Scope

- In scope: hosted Junction platform-config assembly, runtime-config
  normalization, and focused owner-boundary tests.
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
3. Add focused failing regressions at the hosted assembly and provider
   continuation boundaries, then implement the smallest correction.
4. Run focused tests/typechecks, required review gates, and exact-head CI.
5. Merge/deploy and confirm the affected connection advances its durable
   completion and reconcile frontiers.

## Decisions

- Treat repeated due-reconcile signals as secondary recovery churn, not the
  root cause: retained continuations already suppress duplicate provider roots.
- Preserve omission through hosted platform hydration, then apply the curated
  fallback at normalization. Explicit all-resource configuration remains
  available and unchanged.
- Reuse the full-job continuation decoder for deployment compatibility: a
  structurally valid code-known cursor outside the narrowed configured set
  restarts the same owner window; unknown or malformed cursors still fail
  closed.

## Verification

- Focused hosted-runtime provider-config, device-sync configuration, and
  provider-continuation tests.
- Relevant package typecheck and diff checks.
- Required ReviewGPT/CI gates on the pushed PR head.
- Redacted production aggregate showing durable completion and reconcile
  frontiers advance after deployment.
Completed: 2026-08-18
