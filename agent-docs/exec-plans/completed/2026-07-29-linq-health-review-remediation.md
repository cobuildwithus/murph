# Linq health final-review remediation

## Goal

Close the two accepted final ReviewGPT findings on PR #1118 without adding a
new state owner or rollout process.

## Root causes

1. Line service and reputation were stored independently but still shared one
   projection clock. Missing or unknown values were passed as supplied `null`
   values, so a partial provider snapshot could clear or order out the other
   dimension.
2. The additive predeploy migration reconstructed the legacy
   `health_status` column before the replacement Web deployment was live. The
   old build could therefore treat a provider-blocked line as assignable during
   the build/drain window or after a failed deploy.

## Smallest correction

- Keep the existing `HostedLinqLine` projection and add per-dimension
  timestamp/event ordering fields beside the independent statuses.
- Mutate a dimension only for a recognized provider value. Missing, null, and
  unknown values remain event-ledger facts but do not clear projected state.
- Keep the existing overall provider timestamp/event fields for operator
  observability only; they no longer order both dimensions.
- Remove the local-delivery reconstruction from the Prisma predeploy
  migration.
- Run that same bounded reconstruction through the repository's existing
  post-drain contract-migration owner.

## Verification

- Partial and unknown service/reputation snapshots preserve the other
  dimension.
- Delayed updates in opposite dimensions use independent clocks.
- Inventory omissions do not clear hard state.
- Existing final-policy/provider-entry tests still suppress a Linq message for
  `FLAGGED` and `CRITICAL`.
- The predeploy migration never rewrites `health_status`.
- The post-drain contract migration owns the delivery-evidence reconstruction.
- Focused tests, affected typechecks, exact-head CI, and final ReviewGPT
  correction verification pass.
Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
