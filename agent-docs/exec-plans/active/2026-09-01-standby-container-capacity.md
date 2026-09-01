# Standby Container Capacity

Status: active
Created: 2026-09-01
Updated: 2026-09-01

## Goal

Fit the current never-allocated standby declaration within Cloudflare's
production container ceiling without removing the standby class, binding, or
migration, and preserve enough independent standby capacity for any future
allocation and rollback lifecycle.

## Proven cause

- Production declares 748 active two-vCPU runners and one two-vCPU deploy-smoke
  runner. Reusing the active maximum for standby declared another 748 runners,
  taking composed capacity from the 1,500-vCPU account ceiling to 2,994 vCPU.
- The renderer derived standby capacity from the active maximum even while
  standby mode was `off` or `shadow`; the platform rejected the composed
  declaration before the Worker could deploy.
- Runtime mode is not a safe capacity owner after allocation because persisted
  bound standby targets can survive a later mode change.

## Contract

- `CF_STANDBY_CONTAINER_MAX_INSTANCES` independently owns standby platform
  capacity and defaults to `1`. Runtime mode never implicitly changes it.
- Current `off` or `shadow` production may deploy the one-instance cap only
  after read-only evidence proves standby allocation has never produced a bound
  target.
- Before future `allocate`, raise standby capacity to at least
  `CF_CONTAINER_MAX_INSTANCES` while still in `shadow` and prove the live value.
- On rollback, switch mode to `off` while retaining the raised capacity. Reduce
  it only after every bound standby target is independently proven retired.

## Remaining gates

1. Prove the current production cohort has never allocated or retained a bound
   standby target.
2. Land the private `murph-cloud` workflow mapping, guard, test, documentation,
   and deploy summary. Set the owning preview and production GitHub Environment
   variable to `1` after the fallback-compatible workflow is live.
3. Deploy the exact reviewed public and private heads without enabling
   `allocate`.
4. Prove the exact live Worker version, standby binding/class, and container
   declarations: active `748`, deploy smoke `1`, standby `1`, all at the expected
   two-vCPU shape.
5. Confirm the original quota rejection is absent and keep the independent-cap
   rollback rule in the operator handoff.

## Verification

- Regression coverage proves current production arithmetic:
  `748 * 2 + 1 * 2 + 1 * 2 = 1,500` vCPU. A raised standby maximum of 748 is
  separately proven as 2,994 vCPU and is rejected for `allocate` when lower
  than the active maximum.
- Focused deploy-automation and rollout tests pass 34 cases; an independent
  review passes 45 focused cases and finds no public-contract blocker.
- Cloudflare typecheck, `pnpm complexity:diff`, and `git diff --check` pass.
- Exact-diff verification passes 152 node test files (2,785 passed, 2 skipped),
  the six-case container helper, and 15 Workers cases.
- Pending: private workflow/environment proof, current never-allocated proof,
  deploy, and live container/binding verification.
