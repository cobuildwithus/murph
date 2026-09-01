# Standby Container Capacity Correction

## Outcome

Allow the existing standby container application to be created without
duplicating the per-user runner fleet allowance.

## Proven cause

The protected production deploy rendered `StandbyRunnerContainer` with the
same `max_instances` value as `RunnerContainer`. Cloudflare rejected the new
application because that second fleet declaration exceeded the account-wide
vCPU quota. The live Worker remained healthy in standby mode `off`.

## Smallest correction

- Keep `CF_CONTAINER_MAX_INSTANCES` owned by the per-user runner fleet.
- Fix `StandbyRunnerContainer` at one instance, matching the coordinator's
  existing one-slot product contract.
- Keep the checked-in scaffold and hosted-local config faithful to the deploy
  renderer.
- Add focused assertions for the one-instance standby rollout shape.
- Document the capacity ownership explicitly.

No state owner, scheduler, binding, durable field, service, flag, dependency,
or compatibility path is added.

## Verification

- Focused deploy-automation and container rollout tests.
- Focused hosted-local environment config test.
- Cloudflare typecheck.
- Exact-head required GitHub checks before merge.
- Protected forward deploy in mode `off`, followed by exact-version smoke.

## Rollout

Forward-deploy only. Keep standby `off` until the corrected application and
exact deployed fingerprints pass smoke. Then use the already documented
`shadow` observation gate. Do not roll below Durable Object migration `v7`.
Status: completed
Updated: 2026-08-31
Completed: 2026-08-31
