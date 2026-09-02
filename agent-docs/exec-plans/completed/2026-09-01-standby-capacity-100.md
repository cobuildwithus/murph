# Standby container capacity test

## Outcome

Give the standby container application a production capacity ceiling of 100
while reducing the ordinary production runner ceiling from 748 to 648, keeping
the combined account vCPU ceiling unchanged once the one-instance deploy-smoke
application is included.

## Protected invariants

- Standby capacity is only a platform ceiling; the coordinator still maintains
  at most one pristine release-scoped ready slot and member claims retain the
  existing `UserRunner` authority, write fence, restore, retry, and retirement
  owners.
- `max_instances: 100` does not reserve one slot. At saturation, the 100th
  claimed standby container can temporarily leave no ready replacement until
  another standby-class container stops.
- Existing accepted-work durability and cold-path fallback remain unchanged.
- The capacity change introduces no product state, database work, new runtime
  owner, or Vercel/Temporal deployment dependency.
- Production remains in standby `off` while the lower ordinary ceiling and new
  standby application limit converge. Only then may the protected workflow
  move to `shadow`; `allocate` remains outside this task until the documented
  observation gate is satisfied.

## Existing owners

- `apps/cloudflare/scripts/deploy-automation/wrangler-config.ts` owns the
  generated environment-specific container declarations.
- `apps/cloudflare/wrangler.jsonc` is the checked-in scaffold.
- The hosted-local harness owns its bounded local container declarations.
- The protected `murph-cloud` production GitHub Environment owns the ordinary
  runner ceiling through `CF_CONTAINER_MAX_INSTANCES`.
- The protected Cloudflare deploy workflow owns render, validation, Wrangler
  mutation, exact-version smoke, managed-container fingerprints, and live-model
  proof.

## Product UX Patch

- Outcome: members see no pool distinction or new message; this test changes
  only internal capacity while retaining ordinary durable retry and cold-path
  fallback.
- Reaches: ordinary-pool members, future standby-assigned members, and members
  arriving while either class is at capacity retain the same authority and
  reply paths.
- Proof: render all three ceilings directly, deploy first in `off`, observe one
  current-release ready slot in `shadow` with zero claims, and leave `allocate`
  outside this task.

## Implementation

1. Reconcile the sanctioned task worktree with current public `main` and inspect
   the intervening container-readiness change for overlap.
2. Set the standby application ceiling to 100 at the existing config owners,
   keep the deploy-smoke ceiling at one, and preserve the ordinary runner's
   environment-driven ceiling.
3. Forward the separate standby ceiling through the protected deployment
   workflow, and align focused renderer and workflow assertions plus the deploy
   guide without adding another configuration owner.
4. Run focused Cloudflare and hosted-local proof, affected typechecks,
   `pnpm complexity:diff`, privacy/diff inspection, parent final review, and the
   required exact-head PR gates.
5. After merge, set the protected production ordinary ceiling to 648, deploy
   with standby `off`, and require exact-version plus managed-container smoke.
6. After the `off` deployment converges, deploy `shadow` and observe one
   current-release ENAM ready slot with no claimed processing before any later
   allocation decision.

## Failure and rollback

- If the public config or production variable cannot be proven together, leave
  standby `off` and do not dispatch a partial rollout.
- A failed deploy is not convergence. Resolve the live Worker version, mode,
  and container rollout state before retrying.
- Roll back operationally by restoring standby `off`. The numeric capacity
  change creates no new persisted-state rollback floor.

## Verification

- Focused deploy-rendering and checked-in scaffold tests prove ordinary,
  deploy-smoke, and standby ceilings independently.
- Focused hosted-local configuration tests prove its intentional local shape.
- Affected Cloudflare and hosted-local typechecks pass after the final edit.
- Exact-head required CI and the Cloudflare-sensitive final ReviewGPT gate pass.
- Protected production smoke proves the exact deployed version, `off` and then
  `shadow` modes, runner/source fingerprints, direct-R2 path, and live model
  turn; bounded post-deploy evidence proves the shadow coordinator's one ready
  slot without a claimed standby.
Status: completed
Updated: 2026-09-01
Completed: 2026-09-01
